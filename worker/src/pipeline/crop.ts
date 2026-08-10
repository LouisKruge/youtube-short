import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ffmpeg, run } from "../exec.js";
import { log } from "../log.js";

/** worker/scripts/faces.py, from worker/dist/pipeline/crop.js. */
const FACE_SCRIPT = fileURLToPath(new URL("../../scripts/faces.py", import.meta.url));

/** Sampled at this rate; 2fps is plenty to follow a speaker or an action beat. */
const SAMPLE_FPS = 2;
/** Analysis resolution. Tiny on purpose — we want motion, not detail. */
const GRID_W = 96;
const GRID_H = 54;

export interface CropSegment {
  /** Seconds from the clip start. */
  t: number;
  /** Horizontal centre of interest, 0..1 across the frame. */
  center: number;
  /** Vertical centre, 0..1 down the frame. Only face tracking knows this. */
  centerY?: number;
}

export interface CropTrack {
  segments: CropSegment[];
  /** True when the track is flat and a static centre crop is equivalent. */
  static: boolean;
  method: "face" | "motion" | "center";
  /**
   * Height of the crop window as a fraction of frame height, 0..1.
   *
   * A 16:9 source cropped to 9:16 at full height has exactly one degree of
   * freedom — you can slide the window sideways and nothing else. Framing a
   * face vertically means taking a shorter window and scaling it up, which
   * costs sharpness, so this is bounded rather than free.
   */
  windowHeight: number;
  /**
   * Median detected face height, as a fraction of frame height.
   *
   * Stored because it is the number that decides the zoom, and without it a
   * windowHeight of 1 is ambiguous — it means "the face is already large
   * enough", but there is no way to tell how large that was, or how far off the
   * threshold it fell, when the framing turns out to be wrong.
   */
  faceHeight?: number;
}

/** How much of the output height a face should occupy. Ordinary talking-head framing. */
const TARGET_FACE_HEIGHT = 0.15;

/**
 * Floor for the crop window, as a fraction of source height.
 *
 * Full height on a 1080p source is already a 1.78x upscale to reach 1920. At
 * 0.8 it becomes 2.22x. Going further to fit a small face would keep making the
 * picture softer to solve a framing problem, which is the wrong trade.
 */
const MIN_WINDOW_HEIGHT = 0.8;

/** Face centre sits here in the output frame — slightly high, as headroom. */
const FACE_VERTICAL_ANCHOR = 0.4;

/** How long the crop takes to travel between two held positions. */
const PAN_SECONDS = 0.5;

/**
 * Detections must cover at least this share of sampled frames to be believed.
 *
 * Below it the footage is probably not people-on-camera, or the cascade is
 * guessing, and motion tracking is the more honest signal.
 */
const MIN_DETECTION_RATE = 0.35;

/** Minimal binary PGM (P5) reader — the format ffmpeg writes for gray frames. */
function parsePgm(buffer: Buffer): { width: number; height: number; pixels: Buffer } | null {
  if (buffer.subarray(0, 2).toString("ascii") !== "P5") return null;

  let offset = 2;
  const fields: number[] = [];

  // Header is whitespace-separated ints, with # comments allowed between.
  while (fields.length < 3 && offset < buffer.length) {
    const ch = buffer[offset];
    if (ch === 0x23) {
      while (offset < buffer.length && buffer[offset] !== 0x0a) offset++;
      continue;
    }
    if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
      offset++;
      continue;
    }
    let value = 0;
    while (offset < buffer.length && buffer[offset] >= 0x30 && buffer[offset] <= 0x39) {
      value = value * 10 + (buffer[offset] - 0x30);
      offset++;
    }
    fields.push(value);
  }

  if (fields.length < 3) return null;
  offset++; // single whitespace byte before the raster

  const [width, height] = fields;
  return { width, height, pixels: buffer.subarray(offset, offset + width * height) };
}

interface FaceSample {
  t: number;
  cx: number;
  cy: number;
  h: number;
}

/**
 * Face positions over the clip, via OpenCV in a short Python script.
 *
 * Returns null when faces were not found often enough to be trusted — the
 * caller then falls back to motion, which is what this replaced. Never throws:
 * a missing interpreter, a missing cascade or an unreadable file all mean "no
 * face track available", not "the clip cannot be cropped".
 */
async function detectFaces(
  videoPath: string,
  durationSeconds: number,
): Promise<{ samples: FaceSample[]; rate: number } | null> {
  try {
    const { stdout } = await run(
      "python3",
      [FACE_SCRIPT, videoPath, String(SAMPLE_FPS)],
      { timeoutMs: Math.max(5 * 60_000, Math.round(durationSeconds * 2000)) },
    );

    const samples: FaceSample[] = [];
    let sampled = 0;
    let detected = 0;

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, number | boolean>;

      if (row.summary === true) {
        sampled = Number(row.sampled ?? 0);
        detected = Number(row.detected ?? 0);
        continue;
      }

      samples.push({
        t: Number(row.t),
        cx: Number(row.cx),
        cy: Number(row.cy),
        h: Number(row.h),
      });
    }

    const rate = sampled > 0 ? detected / sampled : 0;

    if (samples.length < 3 || rate < MIN_DETECTION_RATE) {
      log.info("Face track rejected, falling back to motion", {
        sampled,
        detected,
        rate: Number(rate.toFixed(2)),
      });
      return null;
    }

    return { samples, rate };
  } catch (err) {
    log.warn("Face detection unavailable, falling back to motion", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Turns face samples into a crop track.
 *
 * The window height comes from the median face, not a per-frame one: the crop
 * dimensions have to be constant for the whole clip — ffmpeg evaluates them
 * once — and a detector that briefly latches onto something the wrong size
 * would otherwise set the zoom for the entire clip.
 */
function trackFromFaces(samples: FaceSample[]): CropTrack {
  const faceHeight = median(samples.map((s) => s.h));

  const windowHeight = Math.min(
    1,
    Math.max(MIN_WINDOW_HEIGHT, faceHeight / TARGET_FACE_HEIGHT),
  );

  // Same smoothing and hysteresis as the motion path: raw per-frame positions
  // jitter, and a crop that chases them reads worse than one that holds still.
  const smoothed: CropSegment[] = [];
  const windowRadius = SAMPLE_FPS * 2;

  for (let i = 0; i < samples.length; i += SAMPLE_FPS) {
    const slice = samples.slice(
      Math.max(0, i - windowRadius),
      Math.min(samples.length, i + windowRadius + 1),
    );
    if (slice.length === 0) continue;

    const cx = slice.reduce((a, s) => a + s.cx, 0) / slice.length;
    const cy = slice.reduce((a, s) => a + s.cy, 0) / slice.length;
    const last = smoothed[smoothed.length - 1];

    if (!last || Math.abs(cx - last.center) > 0.06) {
      smoothed.push({
        t: Number(samples[i].t.toFixed(2)),
        center: Number(Math.max(0.1, Math.min(0.9, cx)).toFixed(4)),
        centerY: Number(Math.max(0.1, Math.min(0.9, cy)).toFixed(4)),
      });
    }
  }

  if (smoothed.length === 0) {
    const cx = median(samples.map((s) => s.cx));
    const cy = median(samples.map((s) => s.cy));
    smoothed.push({ t: 0, center: cx, centerY: cy });
  }

  const spread =
    Math.max(...smoothed.map((s) => s.center)) -
    Math.min(...smoothed.map((s) => s.center));

  log.info("Crop track computed from faces", {
    samples: samples.length,
    segments: smoothed.length,
    faceHeight: Number(faceHeight.toFixed(3)),
    windowHeight: Number(windowHeight.toFixed(3)),
    spread: Number(spread.toFixed(3)),
  });

  return {
    segments: smoothed,
    // Never "static" the way motion is: even a fixed window still has to sit
    // where the face is, which is not the middle of the frame.
    static: false,
    method: "face",
    windowHeight,
    faceHeight: Number(faceHeight.toFixed(4)),
  };
}

/**
 * Works out where to put the 9:16 window over time.
 *
 * Frames are decoded to tiny grayscale rasters and differenced against their
 * predecessor. The column-wise sum of that difference is where things are
 * *changing*, and the intensity-weighted centroid of it is a decent stand-in
 * for "where the subject is" — a talking head, a character entering, an
 * action beat.
 *
 * It is honestly motion tracking, not face tracking. It follows whatever moves
 * most, so on a static two-shot where one person gestures it will favour the
 * gesturing one, and on a locked-off shot with a moving background it can be
 * pulled off the subject. A real face/saliency model would be better; this
 * needs no model and is still much better than always cropping the middle.
 */
export async function computeCropTrack(
  videoPath: string,
  durationSeconds: number,
  workDir: string,
): Promise<CropTrack> {
  // Faces first. Motion answers "what is moving", which in an interview is the
  // microphone and the speaker's hands — the crop chased those and left the
  // face pushed into a corner under a ceiling.
  const faces = await detectFaces(videoPath, durationSeconds);
  if (faces) return trackFromFaces(faces.samples);

  const frameDir = join(workDir, "frames");

  try {
    await mkdir(frameDir, { recursive: true });

    await ffmpeg(
      [
        "-i",
        videoPath,
        "-vf",
        `fps=${SAMPLE_FPS},scale=${GRID_W}:${GRID_H},format=gray`,
        "-f",
        "image2",
        join(frameDir, "f%05d.pgm"),
      ],
      10 * 60_000,
    );

    const files = (await readdir(frameDir)).filter((f) => f.endsWith(".pgm")).sort();
    if (files.length < 3) return { segments: [], static: true, method: "center", windowHeight: 1 };

    const centers: Array<{ t: number; center: number; weight: number }> = [];
    let previous: Buffer | null = null;

    for (let i = 0; i < files.length; i++) {
      const parsed = parsePgm(await readFile(join(frameDir, files[i])));
      if (!parsed) continue;

      const { width, height, pixels } = parsed;

      if (previous && previous.length === pixels.length) {
        const columns = new Float64Array(width);
        let total = 0;

        for (let y = 0; y < height; y++) {
          const row = y * width;
          for (let x = 0; x < width; x++) {
            const delta = Math.abs(pixels[row + x] - previous[row + x]);
            // Ignore sensor/compression noise; only real movement counts.
            if (delta > 12) {
              columns[x] += delta;
              total += delta;
            }
          }
        }

        if (total > 0) {
          let weighted = 0;
          for (let x = 0; x < width; x++) weighted += columns[x] * (x + 0.5);
          centers.push({
            t: i / SAMPLE_FPS,
            center: weighted / total / width,
            weight: total,
          });
        }
      }

      previous = Buffer.from(pixels);
    }

    if (centers.length === 0) return { segments: [], static: true, method: "center", windowHeight: 1 };

    // Smooth hard, then apply hysteresis. Raw per-frame centroids jump around
    // and a crop that chases them looks worse than one that never moves.
    const smoothed: CropSegment[] = [];
    const windowRadius = SAMPLE_FPS * 2;

    for (let i = 0; i < centers.length; i += SAMPLE_FPS) {
      const from = Math.max(0, i - windowRadius);
      const to = Math.min(centers.length, i + windowRadius + 1);
      const slice = centers.slice(from, to);

      const weight = slice.reduce((a, c) => a + c.weight, 0);
      if (weight === 0) continue;

      const center = slice.reduce((a, c) => a + c.center * c.weight, 0) / weight;
      const last = smoothed[smoothed.length - 1];

      // Only commit a move once it is worth more than the visual cost of moving.
      if (!last || Math.abs(center - last.center) > 0.06) {
        smoothed.push({
          t: Number(centers[i].t.toFixed(2)),
          center: Number(Math.max(0.15, Math.min(0.85, center)).toFixed(4)),
        });
      }
    }

    if (smoothed.length === 0) return { segments: [], static: true, method: "center", windowHeight: 1 };

    const spread =
      Math.max(...smoothed.map((s) => s.center)) - Math.min(...smoothed.map((s) => s.center));

    log.info("Crop track computed", {
      samples: centers.length,
      segments: smoothed.length,
      spread: Number(spread.toFixed(3)),
    });

    return {
      segments: smoothed,
      // A nearly-flat track is not worth a dynamic expression.
      static: spread < 0.08,
      method: "motion",
      // Motion knows nothing about vertical framing; keep the full height.
      windowHeight: 1,
    };
  } catch (err) {
    log.warn("Crop tracking failed, falling back to centre crop", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { segments: [], static: true, method: "center", windowHeight: 1 };
  } finally {
    await rm(frameDir, { recursive: true, force: true });
  }
}

/**
 * Builds the ffmpeg video filter for a 9:16 crop.
 *
 * The source is first scaled so its height fills 1920, then a 1080-wide
 * window is taken from it. `x` is where that window sits. ffmpeg evaluates the
 * expression per frame, so a piecewise expression over `t` genuinely moves the
 * crop during the clip.
 *
 * Held piecewise-constant rather than interpolated: the segments are already
 * heavily smoothed, and a per-frame lerp chain long enough to cover a 30s clip
 * makes the filter string unwieldy for no visible gain.
 */
export function buildCropFilter(track: CropTrack | null, maxSegments = 10): string {
  const scale = "scale=-2:1920:force_original_aspect_ratio=increase";

  if (!track || track.static || track.segments.length === 0) {
    // in_w is the scaled width; centre the 1080 window inside it.
    return `${scale},crop=1080:1920:(in_w-1080)/2:0,setsar=1`;
  }

  const segments = track.segments.slice(0, maxSegments);

  /**
   * Holds each position, then eases to the next over PAN_SECONDS.
   *
   * This was piecewise-constant, on the reasoning that the segments are
   * already smoothed so interpolation "buys nothing a viewer can see". That was
   * wrong, and measurably so: a move is only committed when the centre shifts
   * by more than the hysteresis threshold, which on a frame scaled to 3413px
   * wide is at least a 205-pixel step. Applied instantly, that is a hard cut in
   * framing — and one clip in this source had ten of them inside thirty
   * seconds. A tracked crop that snaps reads worse than one that never moves.
   *
   * Half a second is a deliberate choice over a slower drift: it is fast enough
   * to keep up with a cut to the other speaker, and short enough that it is not
   * mistaken for a camera move of its own.
   */
  const piecewise = (valueFor: (s: CropSegment) => string) => {
    let expression = valueFor(segments[segments.length - 1]);

    for (let i = segments.length - 1; i >= 1; i--) {
      const at = segments[i].t;
      const from = valueFor(segments[i - 1]);
      const to = valueFor(segments[i]);
      const ramp = `${from}+(${to}-(${from}))*(t-${at.toFixed(2)})/${PAN_SECONDS}`;

      expression =
        `if(lt(t\\,${at.toFixed(2)})\\,${from}\\,` +
        `if(lt(t\\,${(at + PAN_SECONDS).toFixed(2)})\\,${ramp}\\,${expression}))`;
    }

    return expression;
  };

  // The motion path has no vertical information, so it keeps the original
  // geometry: scale to fill 1920 high, slide a 1080-wide window sideways.
  if (track.method !== "face" || track.windowHeight >= 1) {
    const x = piecewise(
      (s) => `max(0\\,min(in_w-1080\\,in_w*${s.center.toFixed(4)}-540))`,
    );
    return `${scale},crop=1080:1920:'${x}':0,setsar=1`;
  }

  // Face path. Crop in *source* pixels first and scale afterwards, which is the
  // only way to get a vertical degree of freedom: a window shorter than the
  // frame can be moved up and down, where a full-height one cannot.
  const heightFraction = track.windowHeight.toFixed(4);
  const cropHeight = `trunc(ih*${heightFraction}/2)*2`;
  const cropWidth = `trunc(ih*${heightFraction}*9/16/2)*2`;

  const x = piecewise(
    (s) => `max(0\\,min(iw-ow\\,iw*${s.center.toFixed(4)}-ow/2))`,
  );
  const y = piecewise((s) => {
    const centerY = s.centerY ?? 0.5;
    return `max(0\\,min(ih-oh\\,ih*${centerY.toFixed(4)}-oh*${FACE_VERTICAL_ANCHOR}))`;
  });

  return `crop=${cropWidth}:${cropHeight}:'${x}':'${y}',scale=1080:1920,setsar=1`;
}
