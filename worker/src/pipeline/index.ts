import { basename, join } from "node:path";
import { config } from "../config.js";
import {
  claimClip,
  claimSource,
  db,
  failClip,
  failSource,
  getSettings,
  updateClip,
  type ClipJob,
} from "../db.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir, uploadFile } from "../storage.js";
import { analyzeSource } from "./analyze.js";
import {
  burnCaptions,
  type CaptionPreset,
  type CaptionStyle,
} from "./captions.js";
import { downloadSource } from "./download.js";
import { extractCoverFrames, generateMetadata } from "./metadata.js";
import { refreshStyleProfile } from "./moments.js";
import { segmentClip } from "./segment.js";
import { transcribeClip, type Transcript } from "./transcribe.js";
import { autoApproveStage, uploadStage } from "./upload.js";

/**
 * Stages 5 + 7 — Transcribe the cut clip, then write its metadata.
 *
 * These share a stage because both need the clip transcript and neither is
 * worth a separate claim round-trip. When RENDER_BOTH_CAPTION_STYLES is on,
 * both caption variants are also burned here (see config.ts for the tradeoff).
 */
async function transcribeAndDescribe(job: ClipJob): Promise<void> {
  if (!job.storage_path) throw new Error("Clip has no stored file to transcribe.");

  const dir = await scratchDir("transcribe");

  try {
    const localPath = join(dir, "clip.mp4");
    await downloadFile(job.storage_path, localPath);

    let transcript: Transcript = { text: "", words: [] };
    if (config.transcriptionEnabled) {
      transcript = await transcribeClip(localPath, dir);
    }

    const { data: source } = await db
      .from("source_videos")
      .select("title")
      .eq("id", job.source_video_id)
      .maybeSingle();

    const sourceTitle = (source?.title as string | null) ?? null;

    const metadata = await generateMetadata(transcript, {
      sourceTitle,
      category: job.category,
      rationale: job.rationale,
    });

    // Hooks and title alternatives share the table, separated by `kind`.
    await db.from("hooks").delete().eq("clip_id", job.id);
    await db.from("hooks").insert([
      ...metadata.hooks.map((text) => ({
        owner_id: job.owner_id,
        clip_id: job.id,
        hook_text: text,
        kind: "hook",
        is_selected: false,
      })),
      ...metadata.titles.map((text) => ({
        owner_id: job.owner_id,
        clip_id: job.id,
        hook_text: text,
        kind: "title",
        is_selected: false,
      })),
    ]);

    // Cover frames. Uploaded as JPEGs alongside the clip.
    const duration = Number(job.end_seconds) - Number(job.start_seconds);
    const frames = await extractCoverFrames(localPath, duration, dir);
    const coverPaths: string[] = [];

    for (const frame of frames) {
      const path = `${job.owner_id}/covers/${job.id}-${basename(frame)}`;
      await uploadFile(frame, path, "image/jpeg");
      coverPaths.push(path);
    }

    const captionPaths: Record<string, string> = {};
    if (config.renderBothCaptionStyles && transcript.words.length > 0) {
      const preset = (job.caption_preset ?? "clean") as CaptionPreset;
      for (const style of ["karaoke", "static"] as CaptionStyle[]) {
        const output = await burnCaptions(localPath, transcript, style, dir, preset);
        const path = `${job.owner_id}/captioned/${job.id}-${preset}-${style}.mp4`;
        await uploadFile(output, path, "video/mp4");
        captionPaths[`${preset}:${style}`] = path;
      }
    }

    await updateClip(job.id, {
      status: "ready_for_review",
      transcript,
      caption_paths: captionPaths,
      title: metadata.titles[0] ?? null,
      description: metadata.description,
      hashtags: metadata.hashtags,
      cover_candidates: coverPaths,
      cover_frame_path: coverPaths[0] ?? null,
      claimed_at: null,
      error_message: null,
      attempts: 0,
    });

    log.info("Clip transcribed and described", {
      clipId: job.id,
      words: transcript.words.length,
      hooks: metadata.hooks.length,
      titles: metadata.titles.length,
      covers: coverPaths.length,
      prerendered: Object.keys(captionPaths),
    });
  } finally {
    await cleanup(dir);
  }
}

/** Stage 6 — burn in the style the operator picked, then queue for upload. */
async function renderCaptions(job: ClipJob): Promise<void> {
  if (!job.storage_path) throw new Error("Clip has no stored file to caption.");

  const settings = await getSettings(job.owner_id);
  const style: CaptionStyle = (job.caption_style ??
    settings.default_caption_style) as CaptionStyle;
  const preset: CaptionPreset = (job.caption_preset ??
    settings.default_caption_preset) as CaptionPreset;
  const transcript = (job.transcript as Transcript | null) ?? { text: "", words: [] };

  // Already rendered this exact combination — nothing to redo.
  const key = `${preset}:${style}`;
  const existing = job.caption_paths?.[key];
  if (existing) {
    await updateClip(job.id, {
      status: "queued",
      caption_burned_path: existing,
      claimed_at: null,
      error_message: null,
      attempts: 0,
    });
    return;
  }

  const dir = await scratchDir("render");

  try {
    const localPath = join(dir, "clip.mp4");
    await downloadFile(job.storage_path, localPath);

    let storagePath: string;

    if (transcript.words.length === 0) {
      // No words to caption — publish the clean crop rather than blocking on
      // a caption track that would be empty anyway.
      storagePath = job.storage_path;
      log.warn("Publishing clip without captions — no transcript words", {
        clipId: job.id,
      });
    } else {
      const output = await burnCaptions(localPath, transcript, style, dir, preset);
      storagePath = `${job.owner_id}/captioned/${job.id}-${preset}-${style}.mp4`;
      await uploadFile(output, storagePath, "video/mp4");
    }

    await updateClip(job.id, {
      status: "queued",
      caption_burned_path: storagePath,
      caption_paths: { ...(job.caption_paths ?? {}), [key]: storagePath },
      claimed_at: null,
      error_message: null,
      attempts: 0,
    });

    log.info("Captions burned in", { clipId: job.id, style, preset });
  } finally {
    await cleanup(dir);
  }
}

/**
 * One pass over the queue. Each stage handles a single job so a long download
 * cannot starve the caption renderer — the loop simply comes back around.
 */
export async function runTick(): Promise<{ handled: number }> {
  let handled = 0;

  // --- Source stages ------------------------------------------------------
  const toDownload = await claimSource(["pending_download"]);
  if (toDownload) {
    handled += 1;
    try {
      await downloadSource(toDownload);
    } catch (err) {
      log.error("Download failed", {
        sourceId: toDownload.id,
        attempt: toDownload.attempts,
        error: err instanceof Error ? err.message : String(err),
      });
      await failSource(toDownload, err);
    }
  }

  const toAnalyze = await claimSource(["downloaded"]);
  if (toAnalyze) {
    handled += 1;
    try {
      await analyzeSource(toAnalyze);
    } catch (err) {
      log.error("Analysis failed", {
        sourceId: toAnalyze.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await failSource(toAnalyze, err);
    }
  }

  // --- Clip stages --------------------------------------------------------
  const toSegment = await claimClip(["pending_segment"]);
  if (toSegment) {
    handled += 1;
    try {
      await segmentClip(toSegment);
    } catch (err) {
      log.error("Segment failed", {
        clipId: toSegment.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await failClip(toSegment, err);
    }
  }

  const toTranscribe = await claimClip(["transcribing"]);
  if (toTranscribe) {
    handled += 1;
    try {
      await transcribeAndDescribe(toTranscribe);
    } catch (err) {
      log.error("Transcription failed", {
        clipId: toTranscribe.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await failClip(toTranscribe, err);
    }
  }

  const toRender = await claimClip(["rendering"]);
  if (toRender) {
    handled += 1;
    try {
      await renderCaptions(toRender);
    } catch (err) {
      log.error("Caption render failed", {
        clipId: toRender.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await failClip(toRender, err);
    }
  }

  // --- Publish stages -----------------------------------------------------
  // These live here rather than in a Vercel cron: a serverless function's
  // execution ceiling is shorter than a 1080x1920 upload routinely takes, and
  // the rendered file is already on this machine.
  try {
    const approved = await autoApproveStage();
    if (approved > 0) {
      handled += approved;
      log.info("Clips auto-approved", { count: approved });
    }
  } catch (err) {
    log.error("Auto-approve failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    if (await uploadStage()) handled += 1;
  } catch (err) {
    log.error("Upload stage failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { handled };
}

/** Drains the queue until there is nothing left to do. */
export async function drain(maxPasses = 40): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const { handled } = await runTick();
    if (handled === 0) break;
    total += handled;
  }

  // Style learning is cheap and only worth doing once the queue is quiet.
  if (total > 0) {
    const { data: owners } = await db.from("app_settings").select("owner_id");
    for (const row of (owners ?? []) as Array<{ owner_id: string }>) {
      await refreshStyleProfile(row.owner_id).catch((err) =>
        log.warn("Style profile refresh failed", {
          ownerId: row.owner_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return total;
}
