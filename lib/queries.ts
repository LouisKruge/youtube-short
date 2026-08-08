import { createAdminClient } from "@/lib/supabase/admin";
import type { Clip, ClipWithContext, Hook, SourceVideo, Upload } from "@/lib/types";

export const MEDIA_BUCKET = "nexus-media";

/** Signed preview URL for a private storage object. */
async function signedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const db = createAdminClient();
  const { data } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export interface SourceRow extends SourceVideo {
  clipCount: number;
  windows: { start: number; end: number }[];
}

export async function loadSources(ownerId: string): Promise<SourceRow[]> {
  const db = createAdminClient();

  const { data: sources } = await db
    .from("source_videos")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (sources ?? []) as unknown as SourceVideo[];
  if (rows.length === 0) return [];

  const { data: clips } = await db
    .from("clips")
    .select("source_video_id, start_seconds, end_seconds")
    .eq("owner_id", ownerId)
    .in(
      "source_video_id",
      rows.map((s) => s.id),
    )
    .neq("status", "rejected");

  const bySource = new Map<string, { start: number; end: number }[]>();
  for (const clip of (clips ?? []) as Array<{
    source_video_id: string;
    start_seconds: number;
    end_seconds: number;
  }>) {
    const list = bySource.get(clip.source_video_id) ?? [];
    list.push({ start: Number(clip.start_seconds), end: Number(clip.end_seconds) });
    bySource.set(clip.source_video_id, list);
  }

  return rows.map((source) => ({
    ...source,
    windows: bySource.get(source.id) ?? [],
    clipCount: (bySource.get(source.id) ?? []).length,
  }));
}

/**
 * Clips for the review grid, ordered so the operator sees what needs a
 * decision first, then what is already moving.
 */
export async function loadClips(ownerId: string): Promise<ClipWithContext[]> {
  const db = createAdminClient();

  const { data } = await db
    .from("clips")
    .select("*, source:source_videos(id, title, source_url, duration_seconds, loudness_envelope)")
    .eq("owner_id", ownerId)
    .not("status", "in", "(pending_segment,rejected)")
    .order("peak_score", { ascending: false })
    .limit(60);

  const clips = (data ?? []) as unknown as Array<
    Clip & { source: ClipWithContext["source"] }
  >;
  if (clips.length === 0) return [];

  const { data: hookRows } = await db
    .from("hooks")
    .select("*")
    .in(
      "clip_id",
      clips.map((c) => c.id),
    )
    .order("created_at", { ascending: true });

  const hooksByClip = new Map<string, Hook[]>();
  for (const hook of (hookRows ?? []) as unknown as Hook[]) {
    const list = hooksByClip.get(hook.clip_id) ?? [];
    list.push(hook);
    hooksByClip.set(hook.clip_id, list);
  }

  const withUrls = await Promise.all(
    clips.map(async (clip) => ({
      ...clip,
      hooks: hooksByClip.get(clip.id) ?? [],
      previewUrl: await signedUrl(clip.caption_burned_path ?? clip.storage_path),
    })),
  );

  const rank: Record<string, number> = {
    ready_for_review: 0,
    rendering: 1,
    queued: 2,
    uploading: 3,
    transcribing: 4,
    cropping: 5,
    segmented: 6,
    uploaded: 7,
    failed: 8,
  };

  return withUrls.sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9),
  );
}

export interface UploadRow extends Upload {
  clip: Pick<Clip, "id" | "start_seconds" | "end_seconds"> | null;
}

export async function loadUploads(ownerId: string): Promise<UploadRow[]> {
  const db = createAdminClient();

  const { data } = await db
    .from("uploads")
    .select("*, clip:clips(id, start_seconds, end_seconds)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []) as unknown as UploadRow[];
}
