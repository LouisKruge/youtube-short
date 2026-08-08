import { createAdminClient } from "@/lib/supabase/admin";
import type { QuotaSnapshot } from "@/lib/types";

/**
 * A videos.insert call costs 1,600 units against a default daily allowance of
 * 10,000. That is a hard ceiling of six uploads per day — the single most
 * important constraint in this product, so it is surfaced everywhere.
 */
export const UPLOAD_COST_UNITS = 1600;

/** YouTube resets quota at midnight Pacific Time, not UTC. */
export function quotaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function getQuota(
  ownerId: string,
  limit: number,
): Promise<QuotaSnapshot> {
  const db = createAdminClient();
  const date = quotaDate();

  const { data } = await db
    .from("quota_usage")
    .select("units_used")
    .eq("owner_id", ownerId)
    .eq("usage_date", date)
    .maybeSingle();

  const unitsUsed = (data?.units_used as number | undefined) ?? 0;

  return {
    date,
    unitsUsed,
    limit,
    unitsPerUpload: UPLOAD_COST_UNITS,
    uploadsRemaining: Math.max(
      0,
      Math.floor((limit - unitsUsed) / UPLOAD_COST_UNITS),
    ),
    uploadsPerDay: Math.floor(limit / UPLOAD_COST_UNITS),
  };
}

// Reserving and releasing quota lives on the worker, next to the upload that
// spends it — see worker/src/quota.ts. The app only ever reads the ledger to
// display it.
