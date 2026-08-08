import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type SettingsPatch = Database["public"]["Tables"]["app_settings"]["Update"];

export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  return NextResponse.json(await getSettings(ownerId));
}

export async function PATCH(request: Request) {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await getSettings(ownerId); // ensure the row exists

  const body = await request.json().catch(() => ({}));
  const patch: SettingsPatch = {};

  if (typeof body.auto_upload_enabled === "boolean") {
    patch.auto_upload_enabled = body.auto_upload_enabled;
  }

  if (body.default_caption_style === "karaoke" || body.default_caption_style === "static") {
    patch.default_caption_style = body.default_caption_style;
  }

  if (["public", "unlisted", "private"].includes(body.youtube_privacy_status)) {
    patch.youtube_privacy_status = body.youtube_privacy_status;
  }

  if (["clean", "punch", "cinematic", "minimal"].includes(body.default_caption_preset)) {
    patch.default_caption_preset = body.default_caption_preset;
  }

  if (typeof body.remove_dead_time === "boolean") {
    patch.remove_dead_time = body.remove_dead_time;
  }

  if (typeof body.smart_crop === "boolean") {
    patch.smart_crop = body.smart_crop;
  }

  const clampInt = (value: unknown, min: number, max: number) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  if (body.clip_length_seconds !== undefined) {
    const v = clampInt(body.clip_length_seconds, 10, 60);
    if (v !== null) patch.clip_length_seconds = v;
  }

  if (body.max_clips_per_source !== undefined) {
    const v = clampInt(body.max_clips_per_source, 1, 40);
    if (v !== null) patch.max_clips_per_source = v;
  }

  if (body.shorts_per_source !== undefined) {
    // Each short costs a Whisper pass plus two ffmpeg encodes, so the ceiling
    // is a cost guard as much as a UX one.
    const v = clampInt(body.shorts_per_source, 1, 50);
    if (v !== null) patch.shorts_per_source = v;
  }

  if (body.daily_quota_limit !== undefined) {
    // The ceiling is a local guard rail, not a grant. Capping the input at
    // 10x default keeps a typo from queueing hundreds of doomed uploads.
    const v = clampInt(body.daily_quota_limit, 1600, 100_000);
    if (v !== null) patch.daily_quota_limit = v;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(await getSettings(ownerId));
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("app_settings")
    .update(patch)
    .eq("owner_id", ownerId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
