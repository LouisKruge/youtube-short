import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

export const DEFAULT_SETTINGS: Omit<AppSettings, "owner_id" | "updated_at"> = {
  // Off by default. The first live upload is always a deliberate act.
  auto_upload_enabled: false,
  default_caption_style: "karaoke",
  clip_length_seconds: 30,
  max_clips_per_source: 8,
  daily_quota_limit: 10000,
  youtube_privacy_status: "public",
};

/** Reads settings for an owner, creating the default row on first access. */
export async function getSettings(ownerId: string): Promise<AppSettings> {
  const db = createAdminClient();

  const { data } = await db
    .from("app_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (data) return data as unknown as AppSettings;

  const { data: created, error } = await db
    .from("app_settings")
    .insert({ owner_id: ownerId, ...DEFAULT_SETTINGS })
    .select("*")
    .single();

  if (error) throw new Error(`Could not create settings: ${error.message}`);
  return created as unknown as AppSettings;
}
