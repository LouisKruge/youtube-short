import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET } from "@/lib/queries";
import {
  UPLOAD_COST_UNITS,
  getQuota,
  releaseUploadQuota,
  reserveUploadQuota,
} from "@/lib/quota";
import { uploadVideo } from "@/lib/youtube";
import type { AppSettings, Clip } from "@/lib/types";

export const dynamic = "force-dynamic";
// Uploading a 30s 1080x1920 clip takes well over the 10s Hobby ceiling.
// Requires Vercel Pro or Fluid Compute; see README.
export const maxDuration = 300;

/** Builds title, description and tags from the clip and its selected hook. */
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

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: owners } = await db.from("app_settings").select("*");

  const report: Array<Record<string, unknown>> = [];

  for (const settings of (owners ?? []) as unknown as AppSettings[]) {
    // The safety gate. Nothing publishes while this is off.
    if (!settings.auto_upload_enabled) {
      report.push({ owner: settings.owner_id, skipped: "auto-upload is off" });
      continue;
    }

    const quota = await getQuota(settings.owner_id, settings.daily_quota_limit);
    if (quota.uploadsRemaining === 0) {
      report.push({
        owner: settings.owner_id,
        skipped: "daily quota exhausted",
        unitsUsed: quota.unitsUsed,
      });
      continue;
    }

    // Highest-energy clips first, capped at what today's quota can carry.
    const { data: queued } = await db
      .from("clips")
      .select("*, source:source_videos(title, source_url)")
      .eq("owner_id", settings.owner_id)
      .eq("status", "queued")
      .not("caption_burned_path", "is", null)
      .order("peak_score", { ascending: false })
      .limit(quota.uploadsRemaining);

    const clips = (queued ?? []) as unknown as Array<
      Clip & { source: { title: string | null; source_url: string } | null }
    >;

    for (const clip of clips) {
      // Reserve before spending. If this returns false another run took the
      // last slot, so stop rather than racing it.
      const reserved = await reserveUploadQuota(
        settings.owner_id,
        settings.daily_quota_limit,
      );
      if (!reserved) {
        report.push({ owner: settings.owner_id, stopped: "quota ceiling reached" });
        break;
      }

      const { data: hook } = await db
        .from("hooks")
        .select("hook_text")
        .eq("clip_id", clip.id)
        .eq("is_selected", true)
        .maybeSingle();

      const meta = buildMetadata(
        (hook?.hook_text as string | null) ?? null,
        clip.source?.title ?? null,
        clip.source?.source_url ?? "",
      );

      const { data: upload } = await db
        .from("uploads")
        .insert({
          owner_id: settings.owner_id,
          clip_id: clip.id,
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          decision: "auto-upload on; highest audio-energy clip in queue",
          quota_units: UPLOAD_COST_UNITS,
          status: "uploading",
        })
        .select("id")
        .single();

      await db.from("clips").update({ status: "uploading" }).eq("id", clip.id);

      try {
        const { data: file, error: dlError } = await db.storage
          .from(MEDIA_BUCKET)
          .download(clip.caption_burned_path!);

        if (dlError || !file) {
          throw new Error(
            `Rendered clip is missing from storage: ${dlError?.message ?? "not found"}`,
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        const result = await uploadVideo({
          ownerId: settings.owner_id,
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          privacyStatus: settings.youtube_privacy_status,
          body: Readable.from(buffer),
        });

        await db
          .from("uploads")
          .update({
            youtube_video_id: result.videoId,
            youtube_url: result.url,
            status: "success",
            uploaded_at: new Date().toISOString(),
          })
          .eq("id", upload!.id);

        await db.from("clips").update({ status: "uploaded" }).eq("id", clip.id);

        report.push({ owner: settings.owner_id, uploaded: result.url });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";

        // YouTube charges quota on request, not on success — so only refund
        // when the failure happened before the API was ever called.
        const chargedByYouTube = !/storage|missing|No YouTube channel/i.test(message);
        if (!chargedByYouTube) await releaseUploadQuota(settings.owner_id);

        await db
          .from("uploads")
          .update({
            status: "failed",
            error_message: message,
            quota_units: chargedByYouTube ? UPLOAD_COST_UNITS : 0,
          })
          .eq("id", upload!.id);

        await db
          .from("clips")
          .update({ status: "failed", error_message: message })
          .eq("id", clip.id);

        report.push({ owner: settings.owner_id, failed: message });
      }
    }
  }

  return NextResponse.json({ ok: true, report });
}
