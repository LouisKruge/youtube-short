import { join } from "node:path";
import { config } from "../config.js";
import { db, getSettings, updateSource, type SourceJob } from "../db.js";
import { ffmpeg } from "../exec.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir } from "../storage.js";

export interface Silence {
  start: number;
  end: number;
}

export interface Candidate {
  start: number;
  end: number;
  score: number;
}

/**
 * Reads an RMS-level sample every `analysisHopSeconds` across the whole audio
 * track. astats with `reset=1` restarts its accumulator every frame, and
 * asetnsamples fixes the frame length, so each printed value covers exactly
 * one hop.
 */
export async function loudnessEnvelope(inputPath: string): Promise<number[]> {
  const sampleRate = 8000;
  const samplesPerFrame = Math.max(
    1,
    Math.round(sampleRate * config.analysisHopSeconds),
  );

  const { stderr, stdout } = await ffmpeg(
    [
      "-i",
      inputPath,
      "-vn",
      "-af",
      [
        `aresample=${sampleRate}`,
        "aformat=channel_layouts=mono",
        `asetnsamples=n=${samplesPerFrame}:p=0`,
        "astats=metadata=1:reset=1",
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      ].join(","),
      "-f",
      "null",
      "-",
    ],
    20 * 60_000,
  );

  const envelope: number[] = [];
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    const match = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/);
    if (!match) continue;
    // Digital silence prints as -inf; floor it so the maths stays finite.
    const value = match[1] === "-inf" ? -70 : Number.parseFloat(match[1]);
    if (Number.isFinite(value)) envelope.push(value);
  }

  if (envelope.length === 0) {
    throw new Error(
      "No audio levels were detected. The source may have no audio track.",
    );
  }

  return envelope;
}

/** Silent spans, used to snap cuts so they do not land mid-word. */
export async function detectSilences(inputPath: string): Promise<Silence[]> {
  const { stderr } = await ffmpeg(
    [
      "-i",
      inputPath,
      "-vn",
      "-af",
      "silencedetect=noise=-32dB:d=0.22",
      "-f",
      "null",
      "-",
    ],
    20 * 60_000,
  );

  const silences: Silence[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      pendingStart = Number.parseFloat(start[1]);
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && pendingStart !== null) {
      silences.push({ start: pendingStart, end: Number.parseFloat(end[1]) });
      pendingStart = null;
    }
  }

  return silences;
}

/** Nearest silence midpoint within `tolerance`, else the original time. */
function snapToSilence(time: number, silences: Silence[], tolerance = 1.6): number {
  let best = time;
  let bestDistance = tolerance;

  for (const silence of silences) {
    const mid = (silence.start + silence.end) / 2;
    const distance = Math.abs(mid - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mid;
    }
  }

  return best;
}

/**
 * Picks high-energy windows.
 *
 * A peak is loudness standing above its own rolling neighbourhood, which is
 * robust to a source that is uniformly loud or uniformly quiet. Windows are
 * centred on the peak, snapped outward to the nearest natural pause, and
 * taken greedily by score with no overlap.
 *
 * This measures acoustic intensity. It is not, and cannot be, a measure of
 * what viewers actually watched — no public API exposes that for third-party
 * video, so the UI calls these "high-energy moments" and nothing more.
 */
export function pickCandidates(
  envelope: number[],
  durationSeconds: number,
  silences: Silence[],
  options: { clipLength: number; maxClips: number },
): Candidate[] {
  const hop = durationSeconds / envelope.length;
  const half = options.clipLength / 2;

  // Baseline over roughly a minute of audio either side of each sample.
  const radius = Math.max(4, Math.round(30 / hop));

  const scores = envelope.map((value, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(envelope.length, i + radius + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += envelope[j];
    const baseline = sum / (to - from);
    return value - baseline;
  });

  const ranked = scores
    .map((score, i) => ({ score, time: i * hop + hop / 2 }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen: Candidate[] = [];

  for (const peak of ranked) {
    if (chosen.length >= options.maxClips) break;

    let start = snapToSilence(peak.time - half, silences);
    let end = snapToSilence(peak.time + half, silences);

    // Keep the requested length even when the peak sits near either edge.
    if (start < 0) {
      end += -start;
      start = 0;
    }
    if (end > durationSeconds) {
      start -= end - durationSeconds;
      end = durationSeconds;
    }
    start = Math.max(0, start);

    // Snapping can distort the window; discard anything badly out of shape
    // rather than shipping a 4-second or 90-second "30-second clip".
    const length = end - start;
    if (length < options.clipLength * 0.6 || length > options.clipLength * 1.6) {
      continue;
    }

    // No overlap with an already-chosen, higher-scoring window.
    const overlaps = chosen.some((c) => start < c.end && end > c.start);
    if (overlaps) continue;

    chosen.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: Number(peak.score.toFixed(3)),
    });
  }

  return chosen.sort((a, b) => a.start - b.start);
}

/**
 * Stage 2 — Analyze. Produces the loudness envelope the UI renders and one
 * clip row per detected window.
 */
export async function analyzeSource(job: SourceJob): Promise<void> {
  if (!job.storage_path) throw new Error("Source has no stored file to analyze.");

  await updateSource(job.id, { status: "analyzing" });
  const dir = await scratchDir("analyze");

  try {
    const localPath = join(dir, "source.mp4");
    await downloadFile(job.storage_path, localPath);

    const settings = await getSettings(job.owner_id);
    const [envelope, silences] = await Promise.all([
      loudnessEnvelope(localPath),
      detectSilences(localPath),
    ]);

    const duration = job.duration_seconds ?? envelope.length * config.analysisHopSeconds;

    const candidates = pickCandidates(envelope, duration, silences, {
      clipLength: settings.clip_length_seconds,
      maxClips: settings.max_clips_per_source,
    });

    if (candidates.length > 0) {
      const { error } = await db.from("clips").insert(
        candidates.map((c) => ({
          owner_id: job.owner_id,
          source_video_id: job.id,
          start_seconds: c.start,
          end_seconds: c.end,
          peak_score: c.score,
          status: "pending_segment",
        })),
      );
      if (error) throw new Error(`Could not create clips: ${error.message}`);
    }

    // The UI ribbon only needs a few hundred points; storing one sample every
    // half second for an hour-long source would be a 7,200-element blob.
    const targetPoints = 480;
    const stride = Math.max(1, Math.ceil(envelope.length / targetPoints));
    const downsampled: number[] = [];
    for (let i = 0; i < envelope.length; i += stride) {
      const slice = envelope.slice(i, i + stride);
      downsampled.push(
        Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1)),
      );
    }

    await updateSource(job.id, {
      status: "analyzed",
      duration_seconds: duration,
      loudness_envelope: downsampled,
      claimed_at: null,
      error_message: null,
    });

    log.info("Source analyzed", {
      sourceId: job.id,
      clips: candidates.length,
      silences: silences.length,
    });
  } finally {
    await cleanup(dir);
  }
}
