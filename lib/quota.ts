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

/**
 * Atomically reserves quota for one upload. Returns false when the reservation
 * would breach the ceiling — the caller must then leave the clip queued for
 * tomorrow rather than attempting the upload.
 *
 * The check-and-increment happens inside a single SQL function with a row
 * lock, so two overlapping cron invocations cannot both spend the last slot.
 */
export async function reserveUploadQuota(
  ownerId: string,
  limit: number,
): Promise<boolean> {
  const db = createAdminClient();

  const { data, error } = await db.rpc("reserve_quota", {
    p_owner: ownerId,
    p_date: quotaDate(),
    p_units: UPLOAD_COST_UNITS,
    p_ceiling: limit,
  });

  if (error) throw new Error(`Quota reservation failed: ${error.message}`);
  return data === true;
}

/**
 * Releases a reservation when an upload fails before consuming its units.
 * Best-effort: YouTube charges quota on request, not on success, so this is
 * only called for failures that never reached the API (auth, missing file).
 */
export async function releaseUploadQuota(ownerId: string): Promise<void> {
  const db = createAdminClient();
  const date = quotaDate();

  const { data } = await db
    .from("quota_usage")
    .select("units_used")
    .eq("owner_id", ownerId)
    .eq("usage_date", date)
    .maybeSingle();

  const used = (data?.units_used as number | undefined) ?? 0;

  await db
    .from("quota_usage")
    .update({ units_used: Math.max(0, used - UPLOAD_COST_UNITS) })
    .eq("owner_id", ownerId)
    .eq("usage_date", date);
}
