import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/supabase/server";
import { nudgeWorker } from "@/lib/worker";
import type { Database } from "@/lib/supabase/database.types";
import {
  CAPTION_PRESETS,
  LIBRARY_STATUSES,
  type CaptionPreset,
  type CaptionStyle,
  type Clip,
  type LibraryStatus,
} from "@/lib/types";

type ClipPatch = Database["public"]["Tables"]["clips"]["Update"];

export const dynamic = "force-dynamic";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  // The operator may approve a reviewed clip, or reject anything unpublished.
  ready_for_review: ["rendering", "rejected"],
  rendering: ["rejected"],
  queued: ["rejected"],
  failed: ["rejected", "ready_for_review"],
  cropping: ["rejected"],
  transcribing: ["rejected"],
  segmented: ["rejected"],
};

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const ownerId = await requireOwner();
  if (!ownerId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const db = createAdminClient();

  const { data: existing } = await db
    .from("clips")
    .select("*")
    .eq("id", params.id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  const clip = existing as unknown as Clip;

  const patch: ClipPatch = {};

  // Caption style ----------------------------------------------------------
  if (body.captionStyle !== undefined) {
    const style = body.captionStyle as CaptionStyle;
    if (style !== "karaoke" && style !== "static") {
      return NextResponse.json({ error: "Unknown caption style" }, { status: 400 });
    }
    patch.caption_style = style;

    // When both variants were pre-rendered, selecting a style is instant.
    const prerendered = clip.caption_paths?.[style];
    if (prerendered) patch.caption_burned_path = prerendered;
  }

  // Hook selection ---------------------------------------------------------
  if (typeof body.hookId === "string") {
    const { data: hook } = await db
      .from("hooks")
      .select("id, kind")
      .eq("id", body.hookId)
      .eq("clip_id", clip.id)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (!hook) {
      return NextResponse.json({ error: "Hook not found" }, { status: 404 });
    }

    // Clear then set within this kind — the partial unique index is per
    // (clip, kind), so a clip can have one selected hook and one title.
    await db
      .from("hooks")
      .update({ is_selected: false })
      .eq("clip_id", clip.id)
      .eq("kind", (hook as { kind: string }).kind);
    await db.from("hooks").update({ is_selected: true }).eq("id", body.hookId);
  }

  // Library workflow state — independent of the processing status, so it can
  // move at any time including after publishing.
  if (typeof body.libraryStatus === "string") {
    if (!LIBRARY_STATUSES.includes(body.libraryStatus as LibraryStatus)) {
      return NextResponse.json({ error: "Unknown library status" }, { status: 400 });
    }
    patch.library_status = body.libraryStatus;
  }

  // Visual preset. Changing it invalidates the burned-in render, so the clip
  // has to go back through the caption stage.
  if (typeof body.captionPreset === "string") {
    if (!CAPTION_PRESETS.includes(body.captionPreset as CaptionPreset)) {
      return NextResponse.json({ error: "Unknown caption preset" }, { status: 400 });
    }
    patch.caption_preset = body.captionPreset;
    const key = `${body.captionPreset}:${patch.caption_style ?? clip.caption_style}`;
    patch.caption_burned_path = clip.caption_paths?.[key] ?? null;
  }

  // Accept or reject the suggested hook restructure. Applying it changes where
  // the clip starts, so any existing render is stale.
  if (typeof body.applyHook === "boolean" && clip.hook_analysis) {
    patch.hook_analysis = { ...clip.hook_analysis, applied: body.applyHook };
    if (body.applyHook) {
      patch.status = "pending_segment";
      patch.caption_burned_path = null;
      patch.caption_paths = {};
      patch.attempts = 0;
    }
  }

  // Cover frame choice, restricted to the extracted candidates so this cannot
  // be pointed at an arbitrary storage path.
  if (typeof body.coverFramePath === "string") {
    if (!(clip.cover_candidates ?? []).includes(body.coverFramePath)) {
      return NextResponse.json(
        { error: "That cover frame is not one of this clip's candidates." },
        { status: 400 },
      );
    }
    patch.cover_frame_path = body.coverFramePath;
  }

  // Editable metadata.
  if (typeof body.title === "string") patch.title = body.title.slice(0, 100);
  if (typeof body.description === "string") {
    patch.description = body.description.slice(0, 5000);
  }
  if (Array.isArray(body.hashtags)) {
    patch.hashtags = body.hashtags
      .map((h: unknown) => String(h ?? "").replace(/^#+/, "").trim().toLowerCase())
      .filter((h: string) => h.length > 0)
      .slice(0, 15);
  }

  // Status transition ------------------------------------------------------
  if (typeof body.status === "string") {
    const allowed = ALLOWED_TRANSITIONS[clip.status] ?? [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: `Cannot move a clip from ${clip.status} to ${body.status}.` },
        { status: 409 },
      );
    }

    if (body.status === "rendering") {
      const style = ((patch.caption_style as CaptionStyle | null) ??
        clip.caption_style) as CaptionStyle | null;
      if (!style) {
        return NextResponse.json(
          { error: "Pick a caption style before approving." },
          { status: 400 },
        );
      }

      const { count } = await db
        .from("hooks")
        .select("id", { count: "exact", head: true })
        .eq("clip_id", clip.id)
        .eq("is_selected", true);

      if (!count && typeof body.hookId !== "string") {
        return NextResponse.json(
          { error: "Pick a hook before approving." },
          { status: 400 },
        );
      }

      // Both variants already on disk — skip the render stage entirely.
      const ready = patch.caption_burned_path ?? clip.caption_paths?.[style];
      patch.status = ready ? "queued" : "rendering";
      if (ready) patch.caption_burned_path = ready;
      patch.error_message = null;
      patch.attempts = 0;
    } else {
      patch.status = body.status;
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from("clips")
      .update(patch)
      .eq("id", clip.id)
      .eq("owner_id", ownerId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (patch.status === "rendering") void nudgeWorker();

  const { data: fresh } = await db
    .from("clips")
    .select("*")
    .eq("id", clip.id)
    .single();

  const { data: hooks } = await db
    .from("hooks")
    .select("*")
    .eq("clip_id", clip.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ ...(fresh as object), hooks: hooks ?? [] });
}
