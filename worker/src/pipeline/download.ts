import { join } from "node:path";
import { ffprobe, ytdlp } from "../exec.js";
import { log } from "../log.js";
import { cleanup, scratchDir, uploadFile } from "../storage.js";
import { updateSource, type SourceJob } from "../db.js";

interface Probe {
  durationSeconds: number;
}

async function probe(path: string): Promise<Probe> {
  const { stdout } = await ffprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read a duration from the downloaded file.");
  }
  return { durationSeconds: duration };
}

/**
 * Stage 1 — Ingest.
 *
 * Pulls the operator-supplied URL down with yt-dlp and parks the file in
 * Supabase Storage. Nexus does not judge what the URL points at; rights and
 * platform terms are the operator's call.
 */
export async function downloadSource(job: SourceJob): Promise<void> {
  await updateSource(job.id, { status: "downloading" });
  const dir = await scratchDir("src");

  try {
    // Read the title first — one cheap metadata call, and it gives the
    // operator something recognizable in the queue while the download runs.
    let title: string | null = null;
    try {
      const { stdout } = await ytdlp(
        ["--no-warnings", "--skip-download", "--print", "%(title)s", job.source_url],
        60_000,
      );
      title = stdout.trim().split("\n")[0] || null;
      if (title) await updateSource(job.id, { title });
    } catch (err) {
      log.warn("Could not read source title", {
        sourceId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const output = join(dir, "source.%(ext)s");
    await ytdlp(
      [
        "--no-warnings",
        "--no-playlist",
        // Cap at 1080p — the output is 1080x1920, so a 4K source is pure
        // download time and disk for no gain.
        "-f",
        "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        output,
        job.source_url,
      ],
      45 * 60_000,
    );

    const localPath = join(dir, "source.mp4");
    const { durationSeconds } = await probe(localPath);

    const storagePath = `${job.owner_id}/sources/${job.id}.mp4`;
    await uploadFile(localPath, storagePath, "video/mp4");

    await updateSource(job.id, {
      status: "downloaded",
      storage_path: storagePath,
      duration_seconds: durationSeconds,
      title,
      claimed_at: null,
      error_message: null,
      // Attempts are per stage — reset so the analyze stage gets its own budget.
      attempts: 0,
    });

    log.info("Source downloaded", {
      sourceId: job.id,
      durationSeconds: Math.round(durationSeconds),
    });
  } finally {
    await cleanup(dir);
  }
}
