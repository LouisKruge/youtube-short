import { redirect } from "next/navigation";
import { missingCoreEnv } from "@/lib/config-check";
import { getQuota } from "@/lib/quota";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings, QuotaSnapshot } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

export interface PageContext {
  ownerId: string;
  email: string | null;
  settings: AppSettings;
  quota: QuotaSnapshot;
  /** Sources and clips currently mid-pipeline. Drives the top-bar readout. */
  processing: number;
}

/** Statuses that mean the worker either holds this row or is about to. */
const SOURCES_IN_FLIGHT = [
  "pending_download",
  "downloading",
  "downloaded",
  "analyzing",
];

const CLIPS_IN_FLIGHT = [
  "pending_segment",
  "segmented",
  "cropping",
  "transcribing",
  "rendering",
  "uploading",
];

/**
 * Every page starts here: authenticated owner, their settings, their quota, and
 * the in-flight count the chrome reports.
 *
 * The three counts run in parallel with the settings read — they are `head`
 * queries, so this costs one round trip, not four.
 */
export async function pageContext(): Promise<PageContext> {
  // Middleware only gates on the two public Supabase values, since that is all
  // its own client needs. Pages additionally need the service-role key, so a
  // deployment missing only that would otherwise 500 here.
  if (missingCoreEnv().length > 0) redirect("/setup");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const ownerId = user.id;

  const settings = await getSettings(ownerId);
  const db = createAdminClient();

  const [quota, sources, clips] = await Promise.all([
    getQuota(ownerId, settings.daily_quota_limit),
    db
      .from("source_videos")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("status", SOURCES_IN_FLIGHT),
    db
      .from("clips")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("status", CLIPS_IN_FLIGHT),
  ]);

  return {
    ownerId,
    email: user.email ?? null,
    settings,
    quota,
    processing: (sources.count ?? 0) + (clips.count ?? 0),
  };
}
