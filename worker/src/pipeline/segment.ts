import { join } from "node:path";
import { db, getSettings, updateClip, type ClipJob } from "../db.js";
import { ffmpeg } from "../exec.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir, uploadFile } from "../storage.js";
import { buildCropFilter, computeCropTrack } from "./crop.js";
import {
  buildDeadTimeFilters,
  detectDeadTime,
  totalDeadSeconds,
  type DeadSpan,
} from "./deadtime.js";

/**
 * Stages 3 + 4 — Segment, crop to 9:16, and trim dead time.
 *
 * Done in two ffmpeg passes rather than one. The first cuts the window at the
 * source resolution so crop tracking and dead-time detection have real footage
 * to measure; the second applies both. Measuring on an already-cropped clip
 * would be circular — the tracker would only ever see what the centre crop
 * happened to include.
 */
export async function segmentClip(job: ClipJob): Promise<void> {
  await updateClip(job.id, { status: "cropping" });
  const dir = await scratchDir("clip");

  try {
    const { data: source } = await db
      .from("source_videos")
      .select("storage_path")
      .eq("id", job.source_video_id)
      .maybeSingle();

    const sourcePath = source?.storage_path as string | undefined;
    if (!sourcePath) throw new Error("The source video is no longer available.");

    const settings = await getSettings(job.owner_id);

    const localSource = join(dir, "source.mp4");
    const inputPath = await downloadFile(sourcePath, localSource);

    let start = Number(job.start_seconds);
    const end = Number(job.end_seconds);

    // Hook restructure: when the operator accepted the suggestion, open on the
    // strongest beat instead of the window's original start.
    const hook = job.hook_analysis as
      | { best_opening_at?: number; applied?: boolean }
      | null;
    if (hook?.applied && typeof hook.best_opening_at === "number" && hook.best_opening_at > 0) {
      start = Number((start + hook.best_opening_at).toFixed(2));
      log.info("Applying hook restructure", {
        clipId: job.id,
        offsetSeconds: hook.best_opening_at,
      });
    }

    const duration = Math.max(3, end - start);

    // --- Pass 1: cut the window, full frame -------------------------------
    const rough = join(dir, "rough.mp4");
    await ffmpeg(
      [
        // -ss before -i seeks fast; -accurate_seek keeps the cut frame-exact.
        "-accurate_seek",
        "-ss",
        String(start),
        "-i",
        inputPath,
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        rough,
      ],
      15 * 60_000,
    );

    // --- Measure ----------------------------------------------------------
    const cropTrack = settings.smart_crop
      ? await computeCropTrack(rough, duration, dir)
      : null;

    let deadSpans: DeadSpan[] = [];
    if (settings.remove_dead_time) {
      deadSpans = await detectDeadTime(rough, duration);
    }

    const deadFilters = buildDeadTimeFilters(deadSpans);
    const cropFilter = buildCropFilter(cropTrack);

    // --- Pass 2: crop to 9:16, drop dead time -----------------------------
    const output = join(dir, "clip.mp4");

    // select= renumbers frames, so it has to run before the crop expression
    // that reads `t` — otherwise the timestamps the crop sees are the ones
    // being discarded.
    const videoFilter = deadFilters
      ? `${deadFilters.video},${cropFilter}`
      : cropFilter;

    await ffmpeg(
      [
        "-i",
        rough,
        "-vf",
        videoFilter,
        ...(deadFilters ? ["-af", deadFilters.audio] : []),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        // Shorts are watched on phones; a keyframe every second keeps
        // scrubbing responsive without bloating the file.
        "-g",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        output,
      ],
      15 * 60_000,
    );

    const storagePath = `${job.owner_id}/clips/${job.id}.mp4`;
    await uploadFile(output, storagePath, "video/mp4");

    await updateClip(job.id, {
      status: "transcribing",
      storage_path: storagePath,
      start_seconds: start,
      crop_track: cropTrack,
      dead_time: deadSpans,
      dead_time_removed: deadSpans.length > 0,
      claimed_at: null,
      error_message: null,
      // Attempts are per stage, not per clip. Without this reset a clip that
      // simply progressed through three stages would hit MAX_ATTEMPTS and be
      // parked as failed on its first genuine retry.
      attempts: 0,
    });

    log.info("Clip cut and cropped", {
      clipId: job.id,
      duration: Number(duration.toFixed(2)),
      cropMethod: cropTrack?.method ?? "center",
      cropSegments: cropTrack?.segments.length ?? 0,
      deadTimeRemoved: totalDeadSeconds(deadSpans),
    });
  } finally {
    await cleanup(dir);
  }
}
