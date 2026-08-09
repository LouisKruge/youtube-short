import { join } from "node:path";
import { createReadStream } from "node:fs";
import {
  claimQueuedClip,
  db,
  listOwners,
  updateClip,
  type ClipJob,
  type OwnerSettings,
} from "../db.js";
import { log } from "../log.js";
import { cleanup, downloadFile, scratchDir } from "../storage.js";
import {
  UPLOAD_COST_UNITS,
  releaseUploadQuota,
  reserveUploadQuota,
  uploadsRemaining,
} from "../quota.js";
import { hasConnectedChannel, uploadVideo } from "../youtube.js";

/**
 * Stage 8 — Auto-approve.
 *
 * Fully-automatic mode: pick the default caption style and the top-ranked
 * hook for anything sitting in review, then send it to render. Runs only
 * while auto-upload is on; every decision is recorded on the upload row when
 * the clip eventually publishes.
 */
export async function autoApproveStage(): Promise<number> {
  let approved = 0;

  for (const settings of await listOwners()) {
    if (!settings.auto_upload_enabled) continue;

    const { data: clips } = await db
      .from("clips")
      .select("id, caption_style, caption_paths")
      .eq("owner_id", settings.owner_id)
      .eq("status", "ready_for_review")
      .limit(50);

    for (const clip of (clips ?? []) as Array<{
      id: string;
      caption_style: string | null;
      caption_paths: Record<string, string> | null;
    }>) {
      const style = clip.caption_style ?? settings.default_caption_style;

      const { data: hooks } = await db
        .from("hooks")
        .select("id, is_selected")
        .eq("clip_id", clip.id)
        .order("created_at", { ascending: true });

      const rows = (hooks ?? []) as Array<{ id: string; is_selected: boolean }>;
      if (rows.length === 0) continue;

      if (!rows.some((h) => h.is_selected)) {
        // The model orders hooks strongest first, so the first row wins.
        await db.from("hooks").update({ is_selected: true }).eq("id", rows[0].id);
      }

      const prerendered = clip.caption_paths?.[style];

      await updateClip(clip.id, {
        caption_style: style,
        status: prerendered ? "queued" : "rendering",
        ...(prerendered ? { caption_burned_path: prerendered } : {}),
        error_message: null,
        attempts: 0,
      });

      approved += 1;
    }
  }

  return approved;
}

function buildMetadata(
  hook: string | null,
  sourceTitle: string | null,
  sourceUrl: string,
) {
  const title = (hook ?? sourceTitle ?? "Clip").slice(0, 95);

  const description = [
    hook,
    "",
    sourceTitle ? `From: ${sourceTitle}` : null,
    `Source: ${sourceUrl}`,
    "",
    "Clipped automatically with Nexus Clips.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { title, description, tags: ["shorts", "clip"] };
}

async function publish(clip: ClipJob, settings: OwnerSettings): Promise<void> {
  const dir = await scratchDir("upload");

  // Reserve before spending. A false return means another worker took the
  // last slot between our quota check and now.
  const reserved = await reserveUploadQuota(
    settings.owner_id,
    settings.daily_quota_limit,
  );

  if (!reserved) {
    await updateClip(clip.id, { status: "queued", claimed_at: null });
    await cleanup(dir);
    log.info("Quota ceiling reached, clip returned to queue", { clipId: clip.id });
    return;
  }

  const { data: source } = await db
    .from("source_videos")
    .select("title, source_url")
    .eq("id", clip.source_video_id)
    .maybeSingle();

  const { data: hook } = await db
    .from("hooks")
    .select("hook_text")
    .eq("clip_id", clip.id)
    .eq("is_selected", true)
    .maybeSingle();

  const meta = buildMetadata(
    (hook?.hook_text as string | null) ?? null,
    (source?.title as string | null) ?? null,
    (source?.source_url as string | null) ?? "",
  );

  const { data: uploadRow } = await db
    .from("uploads")
    .insert({
      owner_id: settings.owner_id,
      clip_id: clip.id,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      decision: settings.auto_upload_enabled
        ? "auto-upload on; highest audio-energy clip in queue"
        : "manual",
      quota_units: UPLOAD_COST_UNITS,
      status: "uploading",
    })
    .select("id")
    .single();

  const uploadId = (uploadRow as { id: string } | null)?.id;

  try {
    if (!clip.caption_burned_path) {
      throw new Error("Clip has no rendered file to upload.");
    }

    const localPath = join(dir, "upload.mp4");
    await downloadFile(clip.caption_burned_path, localPath);

    const result = await uploadVideo({
      ownerId: settings.owner_id,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      privacyStatus: settings.youtube_privacy_status,
      body: createReadStream(localPath),
    });

    if (uploadId) {
      await db
        .from("uploads")
        .update({
          youtube_video_id: result.videoId,
          youtube_url: result.url,
          status: "success",
          uploaded_at: new Date().toISOString(),
        })
        .eq("id", uploadId);
    }

    await updateClip(clip.id, {
      status: "uploaded",
      claimed_at: null,
      error_message: null,
    });

    log.info("Clip published", { clipId: clip.id, url: result.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";

    // YouTube charges quota on request, not on success — only refund when the
    // failure happened before the API was ever reached.
    const reachedYouTube = !/storage|no rendered file|No YouTube channel|not configured/i.test(
      message,
    );
    if (!reachedYouTube) await releaseUploadQuota(settings.owner_id);

    if (uploadId) {
      await db
        .from("uploads")
        .update({
          status: "failed",
          error_message: message,
          quota_units: reachedYouTube ? UPLOAD_COST_UNITS : 0,
        })
        .eq("id", uploadId);
    }

    // A failed publish is not a failed clip.
    //
    // The clip has already been cut, cropped, captioned and given a cover
    // frame. None of that is invalidated by YouTube refusing the upload, or by
    // there being no channel connected to upload to — and marking it `failed`
    // threw away finished work and hid it from review. Seven perfectly good
    // clips were destroyed this way by a single missing OAuth connection.
    //
    // Publishing state belongs on the `uploads` row, which is written above and
    // already carries the reason. The clip goes back to review, where a human
    // can look at it and try again once the connection exists.
    await updateClip(clip.id, {
      status: "ready_for_review",
      error_message: null,
      last_error: `Publishing failed: ${message}`,
      claimed_at: null,
    });

    log.error("Upload failed, clip returned to review", {
      clipId: clip.id,
      error: message,
    });
  } finally {
    await cleanup(dir);
  }
}

/**
 * Stage 9 — Upload.
 *
 * Handles one clip per pass so a slow upload cannot starve the rest of the
 * pipeline. Returns true when it did work, so the drain loop comes back.
 */
export async function uploadStage(): Promise<boolean> {
  for (const settings of await listOwners()) {
    // The safety gate. Nothing publishes while this is off.
    if (!settings.auto_upload_enabled) continue;

    // No channel, nothing to publish to. Checked before claiming so clips stay
    // in the queue instead of being pulled out one at a time to fail against a
    // condition that is the same for all of them.
    if (!(await hasConnectedChannel(settings.owner_id))) {
      log.warn("Auto-upload is on but no YouTube channel is connected", {
        ownerId: settings.owner_id,
      });
      continue;
    }

    const remaining = await uploadsRemaining(
      settings.owner_id,
      settings.daily_quota_limit,
    );
    if (remaining === 0) continue;

    const clip = await claimQueuedClip(settings.owner_id);
    if (!clip) continue;

    await publish(clip, settings);
    return true;
  }

  return false;
}
