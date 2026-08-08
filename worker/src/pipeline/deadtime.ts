import { ffmpeg } from "../exec.js";

export interface DeadSpan {
  start: number;
  end: number;
  reason: "silence" | "static";
}

/**
 * Finds removable dead time inside one clip.
 *
 * Two detectors, because they catch different things: `silencedetect` finds
 * held pauses in the audio, and `freezedetect` finds held frames — intro
 * cards, loading screens, someone staring at a menu. A span has to be long
 * enough that cutting it is worth the jump cut.
 */
export async function detectDeadTime(
  clipPath: string,
  clipDuration: number,
): Promise<DeadSpan[]> {
  const spans: DeadSpan[] = [];

  const { stderr } = await ffmpeg(
    [
      "-i",
      clipPath,
      "-vf",
      "freezedetect=n=-55dB:d=0.9",
      "-af",
      "silencedetect=noise=-34dB:d=0.65",
      "-f",
      "null",
      "-",
    ],
    10 * 60_000,
  );

  let silenceStart: number | null = null;
  let freezeStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const sStart = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (sStart) {
      silenceStart = Math.max(0, Number.parseFloat(sStart[1]));
      continue;
    }
    const sEnd = line.match(/silence_end:\s*([\d.]+)/);
    if (sEnd && silenceStart !== null) {
      spans.push({
        start: silenceStart,
        end: Number.parseFloat(sEnd[1]),
        reason: "silence",
      });
      silenceStart = null;
      continue;
    }

    const fStart = line.match(/freeze_start:\s*([\d.]+)/);
    if (fStart) {
      freezeStart = Number.parseFloat(fStart[1]);
      continue;
    }
    const fEnd = line.match(/freeze_end:\s*([\d.]+)/);
    if (fEnd && freezeStart !== null) {
      spans.push({
        start: freezeStart,
        end: Number.parseFloat(fEnd[1]),
        reason: "static",
      });
      freezeStart = null;
    }
  }

  // An unterminated silence runs to the end of the clip — that is trailing
  // dead air, which is exactly the kind worth trimming.
  if (silenceStart !== null && clipDuration - silenceStart > 0.65) {
    spans.push({ start: silenceStart, end: clipDuration, reason: "silence" });
  }

  return spans
    .map((s) => ({
      start: Number(Math.max(0, s.start).toFixed(2)),
      end: Number(Math.min(clipDuration, s.end).toFixed(2)),
      reason: s.reason,
    }))
    .filter((s) => s.end - s.start >= 0.65)
    // Never cut into the first second: that is the hook, and a jump cut there
    // is far more damaging than the time it saves.
    .filter((s) => s.end > 1.0)
    .map((s) => ({ ...s, start: Math.max(s.start, 1.0) }))
    .filter((s) => s.end - s.start >= 0.65)
    .sort((a, b) => a.start - b.start);
}

export function totalDeadSeconds(spans: DeadSpan[]): number {
  return Number(spans.reduce((a, s) => a + (s.end - s.start), 0).toFixed(2));
}

/**
 * Builds the filter pair that drops the given spans.
 *
 * Uses select/aselect with concat rather than repeated trim chains: one pass,
 * and video and audio stay in step because both use the same predicate. The
 * expression keeps everything NOT inside a dead span.
 */
export function buildDeadTimeFilters(
  spans: DeadSpan[],
): { video: string; audio: string } | null {
  if (spans.length === 0) return null;

  const keep = spans
    .map((s) => `not(between(t\\,${s.start.toFixed(2)}\\,${s.end.toFixed(2)}))`)
    .join("*");

  return {
    video: `select='${keep}',setpts=N/FRAME_RATE/TB`,
    audio: `aselect='${keep}',asetpts=N/SR/TB`,
  };
}

/** Re-times word timestamps to account for removed spans. */
export function shiftWordsForRemoval<T extends { start: number; end: number }>(
  words: T[],
  spans: DeadSpan[],
): T[] {
  if (spans.length === 0) return words;

  const removedBefore = (t: number) =>
    spans.reduce((total, s) => {
      if (s.end <= t) return total + (s.end - s.start);
      if (s.start < t) return total + (t - s.start);
      return total;
    }, 0);

  return words
    // A word entirely inside a removed span no longer exists.
    .filter((w) => !spans.some((s) => w.start >= s.start && w.end <= s.end))
    .map((w) => ({
      ...w,
      start: Number(Math.max(0, w.start - removedBefore(w.start)).toFixed(3)),
      end: Number(Math.max(0, w.end - removedBefore(w.end)).toFixed(3)),
    }));
}
