import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET } from "@/lib/media";
import type { Clip, ClipWithContext, Hook, SourceVideo, Upload } from "@/lib/types";

export { MEDIA_BUCKET };

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

/** Every clip for the library browser, newest source first. */
export async function loadLibrary(ownerId: string): Promise<ClipWithContext[]> {
  const db = createAdminClient();

  const { data } = await db
    .from("clips")
    .select(
      "*, source:source_videos(id, title, source_url, duration_seconds, loudness_envelope)",
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .order("rank", { ascending: true })
    .limit(300);

  const clips = (data ?? []) as unknown as Array<
    Clip & { source: ClipWithContext["source"] }
  >;
  if (clips.length === 0) return [];

  const { data: hookRows } = await db
    .from("hooks")
    .select("*")
    .in("clip_id", clips.map((c) => c.id))
    .order("created_at", { ascending: true });

  const hooksByClip = new Map<string, Hook[]>();
  for (const hook of (hookRows ?? []) as unknown as Hook[]) {
    const list = hooksByClip.get(hook.clip_id) ?? [];
    list.push(hook);
    hooksByClip.set(hook.clip_id, list);
  }

  return clips.map((clip) => ({
    ...clip,
    hooks: hooksByClip.get(clip.id) ?? [],
    // The library is a browsing surface, not a player — skipping the signed
    // URL per clip keeps a 300-row page to one round trip.
    previewUrl: null,
  }));
}

/**
 * One source with everything the project workspace needs: the signed media URL,
 * its scenes, and its clips in rank order.
 */
export interface ProjectDetail {
  source: SourceVideo;
  sourceUrl: string | null;
  scenes: number[];
  clips: ClipWithContext[];
}

export async function loadProject(
  ownerId: string,
  sourceId: string,
): Promise<ProjectDetail | null> {
  const db = createAdminClient();

  const { data: source } = await db
    .from("source_videos")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", sourceId)
    .maybeSingle();

  if (!source) return null;
  const row = source as unknown as SourceVideo;

  const [{ data: clipRows }, { data: sceneRows }, signed] = await Promise.all([
    db
      .from("clips")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("source_video_id", sourceId)
      .order("rank", { ascending: true, nullsFirst: false })
      .order("start_seconds", { ascending: true }),
    db
      .from("scenes")
      .select("start_seconds")
      .eq("source_video_id", sourceId)
      .order("start_seconds", { ascending: true })
      .limit(600),
    signedUrl(row.storage_path),
  ]);

  const clips = (clipRows ?? []) as unknown as Clip[];

  const { data: hookRows } =
    clips.length > 0
      ? await db
          .from("hooks")
          .select("*")
          .in("clip_id", clips.map((c) => c.id))
          .order("created_at", { ascending: true })
      : { data: [] };

  const hooksByClip = new Map<string, Hook[]>();
  for (const hook of (hookRows ?? []) as unknown as Hook[]) {
    const list = hooksByClip.get(hook.clip_id) ?? [];
    list.push(hook);
    hooksByClip.set(hook.clip_id, list);
  }

  // Only the rendered clips get a signed URL. Signing all of them on a source
  // with thirty candidates is thirty round trips for previews nobody opened.
  const withUrls = await Promise.all(
    clips.map(async (clip) => ({
      ...clip,
      hooks: hooksByClip.get(clip.id) ?? [],
      source: {
        id: row.id,
        title: row.title,
        source_url: row.source_url,
        duration_seconds: row.duration_seconds,
        loudness_envelope: row.loudness_envelope,
      },
      previewUrl: clip.caption_burned_path
        ? await signedUrl(clip.caption_burned_path)
        : null,
    })),
  );

  return {
    source: row,
    sourceUrl: signed,
    scenes: ((sceneRows ?? []) as Array<{ start_seconds: number }>).map((s) =>
      Number(s.start_seconds),
    ),
    clips: withUrls,
  };
}

export interface Overview {
  /** The source worth looking at now: in flight if any, else most recent. */
  active: SourceRow | null;
  activeClips: { total: number; ready: number; published: number };
  /** Highest-scoring clips not yet dealt with, across every source. */
  opportunities: Array<
    Pick<
      Clip,
      "id" | "source_video_id" | "start_seconds" | "end_seconds" | "score" | "rank" | "status"
    > & { sourceTitle: string | null }
  >;
  recent: SourceRow[];
  counts: { needsReview: number; queued: number; published: number };
}

/**
 * The Overview read.
 *
 * Deliberately one pass over a bounded set rather than a live aggregate per
 * card: the dashboard answers "what is happening, what needs me, what next",
 * and all three come out of the same fifty rows.
 */
export async function loadOverview(ownerId: string): Promise<Overview> {
  const db = createAdminClient();
  const sources = await loadSources(ownerId);

  const IN_FLIGHT = ["pending_download", "downloading", "downloaded", "analyzing", "uploading"];
  const active =
    sources.find((s) => IN_FLIGHT.includes(s.status)) ?? sources[0] ?? null;

  const [{ data: clipRows }, needsReview, queued, published, activeCounts] =
    await Promise.all([
      db
        .from("clips")
        .select("id, source_video_id, start_seconds, end_seconds, score, rank, status")
        .eq("owner_id", ownerId)
        .in("status", ["ready_for_review", "segmented", "transcribing", "queued"])
        .not("score", "is", null)
        .order("score", { ascending: false })
        .limit(8),
      db
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("status", "ready_for_review"),
      db
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("status", "queued"),
      db
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("status", "uploaded"),
      active
        ? db
            .from("clips")
            .select("status")
            .eq("owner_id", ownerId)
            .eq("source_video_id", active.id)
        : Promise.resolve({ data: [] as Array<{ status: string }> }),
    ]);

  const titles = new Map(sources.map((s) => [s.id, s.title]));
  const activeStatuses = ((activeCounts.data ?? []) as Array<{ status: string }>).map(
    (c) => c.status,
  );

  return {
    active,
    activeClips: {
      total: activeStatuses.filter((s) => s !== "rejected").length,
      ready: activeStatuses.filter((s) =>
        ["ready_for_review", "queued", "uploaded"].includes(s),
      ).length,
      published: activeStatuses.filter((s) => s === "uploaded").length,
    },
    opportunities: ((clipRows ?? []) as unknown as Overview["opportunities"]).map(
      (clip) => ({
        ...clip,
        sourceTitle: titles.get(clip.source_video_id) ?? null,
      }),
    ),
    recent: sources.slice(0, 6),
    counts: {
      needsReview: needsReview.count ?? 0,
      queued: queued.count ?? 0,
      published: published.count ?? 0,
    },
  };
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
