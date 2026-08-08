import { redirect } from "next/navigation";
import { missingCoreEnv } from "@/lib/config-check";
import { getQuota } from "@/lib/quota";
import { getSettings } from "@/lib/settings";
import type { AppSettings, QuotaSnapshot } from "@/lib/types";
import { requireOwner } from "@/lib/supabase/server";

export interface PageContext {
  ownerId: string;
  settings: AppSettings;
  quota: QuotaSnapshot;
}

/** Every page starts here: authenticated owner, their settings, their quota. */
export async function pageContext(): Promise<PageContext> {
  // Middleware only gates on the two public Supabase values, since that is all
  // its own client needs. Pages additionally need the service-role key, so a
  // deployment missing only that would otherwise 500 here.
  if (missingCoreEnv().length > 0) redirect("/setup");

  const ownerId = await requireOwner();
  if (!ownerId) redirect("/login");

  const settings = await getSettings(ownerId);
  const quota = await getQuota(ownerId, settings.daily_quota_limit);

  return { ownerId, settings, quota };
}
