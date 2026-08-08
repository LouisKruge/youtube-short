import { join } from "node:path";
import { db, updateClip, type ClipJob } from "../db.js";
import { ffmpeg } from "../exec.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir, uploadFile } from "../storage.js";

/**
 * Stages 3 + 4 — Segment and crop, in one encode.
 *
 * Cutting and cropping separately would mean decoding and re-encoding the
 * same footage twice for no quality gain, so they share a pass. The video
 * filter scales the source to *cover* a 1080x1920 frame and centre-crops the
 * overflow — the standard, predictable transform. It has no idea where the
 * subject is; a two-shot will lose one of the two.
 */
const VERTICAL_FILTER = [
  "scale=1080:1920:force_original_aspect_ratio=increase",
  "crop=1080:1920",
  "setsar=1",
].join(",");

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

    const localSource = join(dir, "source.mp4");
    await downloadFile(sourcePath, localSource);

    const output = join(dir, "clip.mp4");
    const duration = Number(job.end_seconds) - Number(job.start_seconds);

    await ffmpeg(
      [
        // -ss before -i seeks fast; -accurate_seek keeps the cut frame-exact.
        "-accurate_seek",
        "-ss",
        String(job.start_seconds),
        "-i",
        localSource,
        "-t",
        String(duration),
        "-vf",
        VERTICAL_FILTER,
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
      claimed_at: null,
      error_message: null,
      // Attempts are per stage, not per clip. Without this reset a clip that
      // simply progressed through three stages would hit MAX_ATTEMPTS and be
      // parked as failed on its first genuine retry.
      attempts: 0,
    });

    log.info("Clip cut and cropped", { clipId: job.id, duration });
  } finally {
    await cleanup(dir);
  }
}
