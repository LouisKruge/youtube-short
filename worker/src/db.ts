import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface SourceJob {
  id: string;
  owner_id: string;
  source_url: string;
  title: string | null;
  status: string;
  storage_path: string | null;
  duration_seconds: number | null;
  attempts: number;
}

export interface ClipJob {
  id: string;
  owner_id: string;
  source_video_id: string;
  start_seconds: number;
  end_seconds: number;
  status: string;
  storage_path: string | null;
  caption_style: "karaoke" | "static" | null;
  caption_preset: "clean" | "punch" | "cinematic" | "minimal" | null;
  caption_paths: Record<string, string>;
  caption_burned_path: string | null;
  transcript: unknown;
  rank: number | null;
  score: number | null;
  category: string | null;
  rationale: string | null;
  hook_analysis: unknown;
  dead_time: unknown;
  crop_track: unknown;
  library_status: string;
  attempts: number;
}

/**
 * Claims one job by compare-and-swap on status. Because the update is
 * conditioned on the status we read, two workers racing for the same row
 * produce exactly one winner — the loser's update matches zero rows.
 */
export async function claimSource(statuses: string[]): Promise<SourceJob | null> {
  const staleBefore = new Date(Date.now() - config.claimTimeoutMs).toISOString();

  const { data: candidates } = await db
    .from("source_videos")
    .select("*")
    .in("status", statuses)
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .lt("attempts", config.maxAttempts)
    .order("created_at", { ascending: true })
    .limit(5);

  for (const candidate of (candidates ?? []) as unknown as SourceJob[]) {
    const { data: claimed } = await db
      .from("source_videos")
      .update({
        claimed_at: new Date().toISOString(),
        attempts: candidate.attempts + 1,
      })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .is("error_message", null)
      .select("*")
      .maybeSingle();

    if (claimed) return claimed as unknown as SourceJob;
  }

  return null;
}

export async function claimClip(statuses: string[]): Promise<ClipJob | null> {
  const staleBefore = new Date(Date.now() - config.claimTimeoutMs).toISOString();

  const { data: candidates } = await db
    .from("clips")
    .select("*")
    .in("status", statuses)
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .lt("attempts", config.maxAttempts)
    .order("peak_score", { ascending: false })
    .limit(5);

  for (const candidate of (candidates ?? []) as unknown as ClipJob[]) {
    const { data: claimed } = await db
      .from("clips")
      .update({
        claimed_at: new Date().toISOString(),
        attempts: candidate.attempts + 1,
      })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .select("*")
      .maybeSingle();

    if (claimed) return claimed as unknown as ClipJob;
  }

  return null;
}

export async function updateSource(id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("source_videos").update(patch).eq("id", id);
  if (error) throw new Error(`Could not update source ${id}: ${error.message}`);
}

export async function updateClip(id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("clips").update(patch).eq("id", id);
  if (error) throw new Error(`Could not update clip ${id}: ${error.message}`);
}

export async function failSource(job: SourceJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= config.maxAttempts;

  await updateSource(job.id, {
    // Retryable: hand it back to the queue with the attempt count already
    // incremented. Exhausted: park it so a human looks at it.
    status: exhausted ? "failed" : job.status,
    error_message: exhausted ? message : null,
    claimed_at: null,
  });
}

export async function failClip(job: ClipJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= config.maxAttempts;

  await updateClip(job.id, {
    status: exhausted ? "failed" : job.status,
    error_message: exhausted ? message : null,
    claimed_at: null,
  });
}

export interface OwnerSettings {
  owner_id: string;
  auto_upload_enabled: boolean;
  default_caption_style: "karaoke" | "static";
  default_caption_preset: "clean" | "punch" | "cinematic" | "minimal";
  clip_length_seconds: number;
  max_clips_per_source: number;
  shorts_per_source: number;
  remove_dead_time: boolean;
  smart_crop: boolean;
  daily_quota_limit: number;
  youtube_privacy_status: "public" | "unlisted" | "private";
}

const SETTINGS_DEFAULTS = {
  auto_upload_enabled: false,
  default_caption_style: "karaoke" as const,
  default_caption_preset: "clean" as const,
  clip_length_seconds: 30,
  max_clips_per_source: 8,
  shorts_per_source: 10,
  remove_dead_time: true,
  smart_crop: true,
  daily_quota_limit: 10000,
  youtube_privacy_status: "public" as const,
};

export async function getSettings(ownerId: string): Promise<OwnerSettings> {
  const { data } = await db
    .from("app_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return {
    owner_id: ownerId,
    ...SETTINGS_DEFAULTS,
    ...((data ?? {}) as Partial<OwnerSettings>),
  };
}

/** Every owner with a settings row — the worker's unit of work. */
export async function listOwners(): Promise<OwnerSettings[]> {
  const { data } = await db.from("app_settings").select("*");
  return ((data ?? []) as unknown as Partial<OwnerSettings>[]).map((row) => ({
    ...SETTINGS_DEFAULTS,
    ...row,
  })) as OwnerSettings[];
}

/**
 * Claims one queued clip for upload by transitioning it to `uploading` in the
 * same statement that selects it. The status change *is* the lock — a second
 * worker's update matches zero rows, so a clip can never be published twice.
 */
export async function claimQueuedClip(ownerId: string): Promise<ClipJob | null> {
  const { data: candidates } = await db
    .from("clips")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "queued")
    .not("caption_burned_path", "is", null)
    .order("peak_score", { ascending: false })
    .limit(5);

  for (const candidate of (candidates ?? []) as unknown as ClipJob[]) {
    const { data: claimed } = await db
      .from("clips")
      .update({ status: "uploading", claimed_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimed) return claimed as unknown as ClipJob;
  }

  return null;
}
