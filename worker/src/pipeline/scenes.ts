import { ffmpeg } from "../exec.js";

export interface Scene {
  index: number;
  start: number;
  end: number;
}

/**
 * Scene-change detection.
 *
 * ffmpeg's `select=gt(scene,N)` scores each frame against the previous one on
 * colour-histogram distance and emits the ones that jump. That catches hard
 * cuts reliably; slow dissolves and pans it will miss. Frames are sampled at
 * 4fps rather than full rate — a scene boundary a quarter-second out makes no
 * difference to where a clip starts, and it is ~7x less decoding on a 2-hour
 * source.
 */
export async function detectScenes(
  inputPath: string,
  durationSeconds: number,
  threshold = 0.4,
): Promise<Scene[]> {
  const { stdout, stderr } = await ffmpeg(
    [
      "-i",
      inputPath,
      "-an",
      "-filter_complex",
      `fps=4,select='gt(scene,${threshold})',metadata=print:file=-`,
      "-f",
      "null",
      "-",
    ],
    30 * 60_000,
  );

  const cutTimes: number[] = [];
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    // metadata=print emits: frame:N pts:N pts_time:12.345
    const match = line.match(/pts_time:([\d.]+)/);
    if (match) {
      const t = Number.parseFloat(match[1]);
      if (Number.isFinite(t)) cutTimes.push(t);
    }
  }

  const boundaries = [0, ...cutTimes.sort((a, b) => a - b), durationSeconds];

  const scenes: Scene[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    // Sub-second "scenes" are detector noise on fast cuts, not structure.
    if (end - start < 1.2) continue;
    scenes.push({
      index: scenes.length,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
    });
  }

  // A single-camera stream legitimately has no cuts. Treat the whole thing as
  // one scene rather than returning nothing.
  if (scenes.length === 0) {
    return [{ index: 0, start: 0, end: Number(durationSeconds.toFixed(2)) }];
  }

  return scenes;
}
