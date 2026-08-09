#!/usr/bin/env python3
"""
Face positions over time, for the vertical crop.

Emits one JSON object per line on stdout:

    {"t": 1.5, "cx": 0.31, "cy": 0.42, "w": 0.08, "h": 0.14, "n": 2}

cx/cy are the centre of the *dominant* face as fractions of frame width and
height; w/h are its size; n is how many faces were seen in that frame. A frame
with no face emits nothing, and the caller decides whether the hit rate was good
enough to trust — footage with no people in it must fall back to motion rather
than have positions invented for it.

The dominant face is the largest one. In a two-person interview a 9:16 window
cannot hold both at podcast spacing, so something has to be chosen; the nearest
face is the one the shot is usually built around. Picking the *speaking* face
would be better and is not possible here — that needs audio-visual association,
which is the same wall speaker diarization runs into.

Haar cascades rather than a DNN: they ship inside opencv itself, so there is no
model to download at build time and no network dependency in the image. They
are weaker than a modern detector, which is exactly why the caller checks the
hit rate before using any of this.
"""

import json
import sys

import cv2

# Detection runs on a downscaled frame. Faces in a podcast two-shot are ~100px
# on a 1920 frame; at 640 wide that is still ~33px, comfortably above the
# cascade's floor, and it is 9x less work per frame.
ANALYSIS_WIDTH = 640


def cascade_dir():
    """Where the cascade XML lives.

    The pip wheel bundles them and exposes cv2.data.haarcascades. Debian's
    python3-opencv splits them into a separate opencv-data package with no
    cv2.data at all, so both are checked rather than assuming the image was
    built the way this repo's Dockerfile builds it.
    """
    candidates = []
    data = getattr(cv2, "data", None)
    if data is not None:
        candidates.append(data.haarcascades)
    candidates += ["/usr/share/opencv4/haarcascades/", "/usr/share/opencv/haarcascades/"]

    import os

    for path in candidates:
        if path and os.path.exists(path + "haarcascade_frontalface_default.xml"):
            return path
    raise SystemExit("no Haar cascades found; install opencv-python-headless")


def load_cascades():
    base = cascade_dir()
    return (
        cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml"),
        cv2.CascadeClassifier(base + "haarcascade_profileface.xml"),
    )


def detect_in(gray, frontal, profile):
    """Frontal first, then profile, then profile on a mirrored frame.

    The profile cascade is trained on one direction only, so a face turned the
    other way is invisible to it until the image is flipped. In an interview
    both people are usually turned toward each other, which is precisely the
    case a frontal-only detector misses.
    """
    faces = list(frontal.detectMultiScale(gray, 1.1, 5, minSize=(24, 24)))
    if faces:
        return faces

    faces = list(profile.detectMultiScale(gray, 1.1, 5, minSize=(24, 24)))
    if faces:
        return faces

    width = gray.shape[1]
    found = profile.detectMultiScale(cv2.flip(gray, 1), 1.1, 5, minSize=(24, 24))
    # Mirror the boxes back onto the real frame.
    return [(width - x - w, y, w, h) for (x, y, w, h) in found]


def detect(gray, frontal, profile):
    """Plain frame first, histogram-equalised only as a fallback.

    equalizeHist appears in almost every cascade example, and applying it
    unconditionally is wrong: on a frame with a large flat background it
    redistributes the histogram in a way that flattens facial contrast and the
    detector finds nothing at all. Measured on a test frame with a known face,
    plain grayscale found it and the equalised version returned zero.

    It does earn its place on genuinely dark or low-contrast footage, so it
    stays — as the second attempt, not the only one.
    """
    faces = detect_in(gray, frontal, profile)
    if faces:
        return faces
    return detect_in(cv2.equalizeHist(gray), frontal, profile)


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: faces.py VIDEO SAMPLE_FPS", file=sys.stderr)
        return 2

    path = sys.argv[1]
    sample_fps = float(sys.argv[2])

    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        print(f"could not open {path}", file=sys.stderr)
        return 1

    source_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(source_fps / sample_fps)))

    frontal, profile = load_cascades()

    index = 0
    sampled = 0
    detected = 0

    while True:
        ok = capture.grab()
        if not ok:
            break

        if index % step == 0:
            sampled += 1
            ok, frame = capture.retrieve()
            if ok:
                height, width = frame.shape[:2]
                scale = ANALYSIS_WIDTH / float(width)
                small = cv2.resize(frame, (ANALYSIS_WIDTH, max(1, int(height * scale))))
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

                faces = detect(gray, frontal, profile)
                if len(faces):
                    detected += 1
                    sh, sw = gray.shape[:2]
                    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                    print(
                        json.dumps(
                            {
                                "t": round(index / source_fps, 2),
                                "cx": round((x + w / 2) / sw, 4),
                                "cy": round((y + h / 2) / sh, 4),
                                "w": round(w / sw, 4),
                                "h": round(h / sh, 4),
                                "n": len(faces),
                            }
                        ),
                        flush=True,
                    )

        index += 1

    capture.release()

    # The caller needs the hit rate, not just the hits: five good detections out
    # of six hundred frames is noise that happens to be shaped like a face, and
    # cropping to it is worse than not cropping to it at all.
    print(json.dumps({"summary": True, "sampled": sampled, "detected": detected}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # A consumer that stops reading is not an error worth a traceback.
        sys.exit(0)
