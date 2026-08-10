import { join } from "node:path";
import { config } from "../config.js";
import { db, getSettings, updateSource, type SourceJob } from "../db.js";
import { ffmpeg, scanTimeoutMs } from "../exec.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir } from "../storage.js";
import { detectScenes, type Scene } from "./scenes.js";
import { transcribeSource, type Transcript } from "./transcribe.js";
import {
  buildCandidateWindows,
  scoreCandidates,
  type ScoredCandidate,
} from "./moments.js";

export interface Silence {
  start: number;
  end: number;
}

export interface Peak {
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
export async function loudnessEnvelope(
  inputPath: string,
  durationSeconds?: number | null,
): Promise<number[]> {
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
    scanTimeoutMs(durationSeconds),
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
export async function detectSilences(
  inputPath: string,
  durationSeconds?: number | null,
): Promise<Silence[]> {
  const { stderr } = await ffmpeg(
    ["-i", inputPath, "-vn", "-af", "silencedetect=noise=-32dB:d=0.22", "-f", "null", "-"],
    scanTimeoutMs(durationSeconds),
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
 * Picks high-energy windows from the audio.
 *
 * This is now the *first* pass, not the verdict: a peak is loudness standing
 * above its own rolling neighbourhood, which finds where something happens
 * acoustically. Whether that something is worth clipping is decided later by
 * the moment scorer, which can read what was actually said.
 */
export function pickCandidates(
  envelope: number[],
  durationSeconds: number,
  silences: Silence[],
  options: { clipLength: number; maxClips: number },
): Peak[] {
  const hop = durationSeconds / envelope.length;
  const half = options.clipLength / 2;
  const radius = Math.max(4, Math.round(30 / hop));

  const scores = envelope.map((value, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(envelope.length, i + radius + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += envelope[j];
    return value - sum / (to - from);
  });

  const ranked = scores
    .map((score, i) => ({ score, time: i * hop + hop / 2 }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen: Peak[] = [];

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

    if (chosen.some((c) => start < c.end && end > c.start)) continue;

    chosen.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: Number(peak.score.toFixed(3)),
    });
  }

  return chosen.sort((a, b) => a.start - b.start);
}

/** Downsamples the envelope to something the UI ribbon can render. */
function downsample(envelope: number[], targetPoints = 480): number[] {
  const stride = Math.max(1, Math.ceil(envelope.length / targetPoints));
  const out: number[] = [];
  for (let i = 0; i < envelope.length; i += stride) {
    const slice = envelope.slice(i, i + stride);
    out.push(Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1)));
  }
  return out;
}

/** Progressive results, so the UI radar can populate while this still runs. */
async function publishRadar(
  sourceId: string,
  entries: Array<{ start: number; end: number; score: number; label: string }>,
): Promise<void> {
  await updateSource(sourceId, { radar: entries }).catch(() => {});
}

/**
 * Stage 2 — Analyze.
 *
 * Audio energy, silence, scene structure and a full transcript, then a single
 * scoring pass that ranks every candidate against the others. Produces the
 * loudness ribbon, the scene timeline, and one clip row per selected moment
 * carrying its score, factor breakdown, rationale and hook analysis.
 */
export async function analyzeSource(job: SourceJob): Promise<void> {
  if (!job.storage_path) throw new Error("Source has no stored file to analyze.");

  await updateSource(job.id, { status: "analyzing", radar: [] });
  const dir = await scratchDir("analyze");

  try {
    const localPath = join(dir, "source.mp4");
    const sourcePath = await downloadFile(job.storage_path, localPath);

    const settings = await getSettings(job.owner_id);

    const [envelope, silences] = await Promise.all([
      loudnessEnvelope(sourcePath, job.duration_seconds),
      detectSilences(sourcePath, job.duration_seconds),
    ]);

    const duration =
      job.duration_seconds ?? envelope.length * config.analysisHopSeconds;

    // Publish the ribbon immediately — it is the slowest thing to look at and
    // the fastest thing to produce.
    await updateSource(job.id, {
      duration_seconds: duration,
      loudness_envelope: downsample(envelope),
    });

    const scenes: Scene[] = await detectScenes(sourcePath, duration);

    if (scenes.length > 0) {
      await db.from("scenes").delete().eq("source_video_id", job.id);
      await db.from("scenes").insert(
        scenes.map((s) => ({
          owner_id: job.owner_id,
          source_video_id: job.id,
          scene_index: s.index,
          start_seconds: s.start,
          end_seconds: s.end,
        })),
      );
    }

    await updateSource(job.id, { scene_count: scenes.length });

    // Audio peaks first, so the radar has something to show during the long
    // transcription step.
    const want = settings.shorts_per_source;
    const peaks = pickCandidates(envelope, duration, silences, {
      clipLength: settings.clip_length_seconds,
      maxClips: want * 3,
    });

    await publishRadar(
      job.id,
      peaks.slice(0, 24).map((p) => ({
        start: p.start,
        end: p.end,
        score: p.score,
        label: "audio peak",
      })),
    );

    let transcript: Transcript = { text: "", words: [] };
    let transcriptionError: string | null = null;

    if (config.transcriptionEnabled) {
      // A transcript improves the work; it is not a precondition for it. The
      // pipeline already runs without one — that is exactly what
      // TRANSCRIPTION_ENABLED=false does — so a provider being down, out of
      // credit or rate limited should cost captions, not the whole source.
      //
      // It failed hard before: an account with no credit threw away the
      // envelope, the scene detection and the moment selection, three times,
      // and left nothing to review.
      //
      // Degrading is not the same as hiding. The reason is recorded and the
      // readout shows the stage as failed rather than quietly complete.
      try {
        transcript = await transcribeSource(sourcePath, dir, duration, (fraction) => {
          log.info("Transcription progress", {
            sourceId: job.id,
            percent: Math.round(fraction * 100),
          });
        });
      } catch (err) {
        transcriptionError = err instanceof Error ? err.message : String(err);
        log.warn("Transcription failed, continuing without a transcript", {
          sourceId: job.id,
          error: transcriptionError,
        });
        await updateSource(job.id, {
          last_error: `Transcription skipped: ${transcriptionError}`,
        });
      }
    }

    const { data: styleRow } = await db
      .from("style_profiles")
      .select("profile")
      .eq("owner_id", job.owner_id)
      .maybeSingle();

    const candidates = buildCandidateWindows({
      peaks,
      scenes,
      transcript,
      durationSeconds: duration,
      clipLength: settings.clip_length_seconds,
      want,
    });

    const scored = await scoreCandidates(candidates, {
      sourceTitle: job.title,
      styleProfile: (styleRow?.profile as unknown) ?? null,
    });

    // Take the best N, then restore chronological order so the clip list reads
    // like the video rather than like a leaderboard.
    const selected: ScoredCandidate[] = scored.slice(0, want);
    const rankById = new Map(selected.map((s, i) => [s.id, i + 1]));
    selected.sort((a, b) => a.start - b.start);

    // Re-analysing a source must replace its clips, not add a second set
    // alongside them. Analysis is normally once per source, but it happens
    // again whenever a stage is fixed and the source is re-queued — and an
    // insert-only path silently doubles the clip list every time.
    //
    // Only untouched clips go. Anything the operator has acted on — approved,
    // queued, published, rejected — is theirs, and a re-run of the automatic
    // part has no business deleting it.
    const { error: clearError } = await db
      .from("clips")
      .delete()
      .eq("source_video_id", job.id)
      .eq("library_status", "unreviewed");

    if (clearError) {
      throw new Error(`Could not clear previous clips: ${clearError.message}`);
    }

    if (selected.length > 0) {
      await db.from("clips").insert(
        selected.map((s) => ({
          owner_id: job.owner_id,
          source_video_id: job.id,
          start_seconds: s.start,
          end_seconds: s.end,
          peak_score: s.energy,
          rank: rankById.get(s.id) ?? null,
          score: s.score,
          score_factors: s.factors,
          rationale: s.rationale,
          category: s.category,
          hook_analysis: {
            best_opening_at: s.hook.bestOpeningAt,
            suggestion: s.hook.suggestion,
            line: s.hook.line,
            applied: false,
          },
          caption_preset: settings.default_caption_preset,
          status: "pending_segment",
        })),
      );
    }

    await publishRadar(
      job.id,
      scored.slice(0, 40).map((s) => ({
        start: s.start,
        end: s.end,
        score: s.score,
        label: s.category,
      })),
    );

    await updateSource(job.id, {
      status: "analyzed",
      duration_seconds: duration,
      transcript,
      transcript_text: transcript.text,
      analysis: {
        candidates_considered: candidates.length,
        clips_selected: selected.length,
        scenes: scenes.length,
        silences: silences.length,
        transcribed: transcript.words.length > 0,
        // Distinguishes "turned off" from "produced no words". Without it the
        // readout leaves Transcription running forever when the stage was never
        // going to run, and holds Moment scoring at waiting behind it.
        transcription_enabled: config.transcriptionEnabled,
        // Attempted and failed, as opposed to never attempted. The readout
        // needs to tell those apart: one is "skipped", the other is "failed",
        // and neither should sit at "running" forever.
        transcription_failed: transcriptionError !== null,
        scored_by_model: scored.some((s) => s.category !== "unrated"),
      },
      claimed_at: null,
      error_message: null,
      // A run that reached the end clears the record of the ones that did not
      // — except a transcription that was skipped, which is the reason these
      // clips have no captions and has to survive the run that produced them.
      last_error: transcriptionError
        ? `Transcription skipped: ${transcriptionError}`
        : null,
      attempts: 0,
    });

    log.info("Source analyzed", {
      sourceId: job.id,
      candidates: candidates.length,
      clips: selected.length,
      scenes: scenes.length,
      words: transcript.words.length,
    });
  } finally {
    await cleanup(dir);
  }
}
