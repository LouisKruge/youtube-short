/**
 * Schema types for supabase/migrations/*.sql.
 *
 * Kept hand-written but structurally identical to what
 * `supabase gen types typescript` emits: a `Row` per table, with `Insert`
 * derived from it so a new column only has to be declared once. Verified
 * against the live project after every migration.
 *
 * Without this generic every query row infers as `never`.
 *
 * The row shapes below MUST stay `type` aliases, not `interface`. Supabase's
 * GenericTable requires `Row extends Record<string, unknown>`, and TypeScript
 * only gives implicit index signatures to type aliases — an interface fails
 * that constraint, the whole schema stops matching GenericSchema, and every
 * query silently degrades back to `never`. The resulting errors point at the
 * call sites, not at this file, so it is a slow one to rediscover.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** Generated columns and defaults are optional on insert. */
type Insertable<Row, Required extends keyof Row> = Partial<Row> & Pick<Row, Required>;

type SourceVideoRow = {
  id: string;
  owner_id: string;
  source_url: string;
  title: string | null;
  status: string;
  storage_path: string | null;
  duration_seconds: number | null;
  loudness_envelope: number[] | null;
  transcript: Json | null;
  transcript_text: string | null;
  analysis: Json | null;
  scene_count: number | null;
  radar: Json;
  error_message: string | null;
  last_error: string | null;
  claimed_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

type ClipRow = {
  id: string;
  owner_id: string;
  source_video_id: string;
  start_seconds: number;
  end_seconds: number;
  peak_score: number | null;
  storage_path: string | null;
  status: string;
  transcript: Json | null;
  caption_style: string | null;
  caption_preset: string;
  caption_burned_path: string | null;
  caption_paths: Record<string, string>;
  // Moment intelligence
  rank: number | null;
  score: number | null;
  score_factors: Json | null;
  rationale: string | null;
  category: string | null;
  hook_analysis: Json | null;
  dead_time: Json;
  dead_time_removed: boolean;
  crop_track: Json | null;
  cover_frame_path: string | null;
  cover_candidates: Json;
  // Workflow + metadata
  library_status: string;
  variant_of: string | null;
  variant_label: string | null;
  title: string | null;
  description: string | null;
  hashtags: string[] | null;
  error_message: string | null;
  last_error: string | null;
  claimed_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

type HookRow = {
  id: string;
  owner_id: string;
  clip_id: string;
  hook_text: string;
  kind: string;
  is_selected: boolean;
  created_at: string;
}

type UploadRow = {
  id: string;
  owner_id: string;
  clip_id: string;
  youtube_video_id: string | null;
  youtube_url: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  decision: string | null;
  quota_units: number;
  uploaded_at: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

type SceneRow = {
  id: string;
  owner_id: string;
  source_video_id: string;
  scene_index: number;
  start_seconds: number;
  end_seconds: number;
  label: string | null;
  created_at: string;
}

type QuotaUsageRow = {
  owner_id: string;
  usage_date: string;
  units_used: number;
}

type AppSettingsRow = {
  owner_id: string;
  auto_upload_enabled: boolean;
  default_caption_style: string;
  default_caption_preset: string;
  clip_length_seconds: number;
  max_clips_per_source: number;
  shorts_per_source: number;
  remove_dead_time: boolean;
  smart_crop: boolean;
  daily_quota_limit: number;
  youtube_privacy_status: string;
  updated_at: string;
}

type YoutubeAccountRow = {
  owner_id: string;
  channel_id: string | null;
  channel_title: string | null;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  connected_at: string;
  updated_at: string;
}

type ScheduleEntryRow = {
  id: string;
  owner_id: string;
  clip_id: string;
  publish_at: string;
  status: string;
  created_at: string;
}

type ClipAnalyticsRow = {
  clip_id: string;
  owner_id: string;
  views: number | null;
  average_view_percentage: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  fetched_at: string;
}

type StyleProfileRow = {
  owner_id: string;
  profile: Json;
  sample_size: number;
  updated_at: string;
}

/**
 * A worker announcing it is alive.
 *
 * Not owner-scoped, unlike every other table here: one worker serves the whole
 * deployment and authenticates with the service-role key rather than as a user.
 */
type WorkerHeartbeatRow = {
  worker_id: string;
  last_seen_at: string;
  detail: Json;
}

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Insertable<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      source_videos: Table<SourceVideoRow, "owner_id" | "source_url">;
      clips: Table<ClipRow, "owner_id" | "source_video_id" | "start_seconds" | "end_seconds">;
      hooks: Table<HookRow, "owner_id" | "clip_id" | "hook_text">;
      uploads: Table<UploadRow, "owner_id" | "clip_id">;
      scenes: Table<
        SceneRow,
        "owner_id" | "source_video_id" | "scene_index" | "start_seconds" | "end_seconds"
      >;
      quota_usage: Table<QuotaUsageRow, "owner_id" | "usage_date">;
      app_settings: Table<AppSettingsRow, "owner_id">;
      youtube_accounts: Table<YoutubeAccountRow, "owner_id" | "refresh_token">;
      schedule_entries: Table<ScheduleEntryRow, "owner_id" | "clip_id" | "publish_at">;
      clip_analytics: Table<ClipAnalyticsRow, "clip_id" | "owner_id">;
      style_profiles: Table<StyleProfileRow, "owner_id">;
      worker_heartbeats: Table<WorkerHeartbeatRow, "worker_id">;
    };
    Views: Record<never, never>;
    Functions: {
      reserve_quota: {
        Args: { p_owner: string; p_date: string; p_units: number; p_ceiling: number };
        Returns: boolean;
      };
      search_transcripts: {
        Args: { q: string };
        Returns: Array<{
          source_video_id: string;
          source_title: string | null;
          headline: string;
          rank: number;
        }>;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
