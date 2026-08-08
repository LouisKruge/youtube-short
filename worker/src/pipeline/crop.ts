import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "../exec.js";
import { log } from "../log.js";

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
}

export interface CropTrack {
  segments: CropSegment[];
  /** True when the track is flat and a static centre crop is equivalent. */
  static: boolean;
  method: "motion" | "center";
}

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
    if (files.length < 3) return { segments: [], static: true, method: "center" };

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

    if (centers.length === 0) return { segments: [], static: true, method: "center" };

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

    if (smoothed.length === 0) return { segments: [], static: true, method: "center" };

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
    };
  } catch (err) {
    log.warn("Crop tracking failed, falling back to centre crop", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { segments: [], static: true, method: "center" };
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

  // center is a fraction of frame width; convert to the window's left edge and
  // clamp so it can never read outside the frame.
  const offsetFor = (center: number) =>
    `max(0\\,min(in_w-1080\\,in_w*${center.toFixed(4)}-540))`;

  // Innermost value is the last segment; wrap outward with lt(t,boundary).
  let expression = offsetFor(segments[segments.length - 1].center);
  for (let i = segments.length - 1; i >= 1; i--) {
    expression = `if(lt(t\\,${segments[i].t.toFixed(2)})\\,${offsetFor(segments[i - 1].center)}\\,${expression})`;
  }

  return `${scale},crop=1080:1920:'${expression}':0,setsar=1`;
}
