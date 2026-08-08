import { db } from "./db.js";

/**
 * A videos.insert call costs 1,600 units against a default daily allowance of
 * 10,000 — a hard ceiling of six uploads per day.
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

export async function unitsUsedToday(ownerId: string): Promise<number> {
  const { data } = await db
    .from("quota_usage")
    .select("units_used")
    .eq("owner_id", ownerId)
    .eq("usage_date", quotaDate())
    .maybeSingle();

  return (data?.units_used as number | undefined) ?? 0;
}

export async function uploadsRemaining(
  ownerId: string,
  limit: number,
): Promise<number> {
  const used = await unitsUsedToday(ownerId);
  return Math.max(0, Math.floor((limit - used) / UPLOAD_COST_UNITS));
}

/**
 * Atomically reserves quota for one upload. Returns false when the
 * reservation would breach the ceiling — the caller must then leave the clip
 * queued for tomorrow rather than attempting the upload.
 *
 * The check-and-increment happens inside a single SQL function holding a row
 * lock, so two workers cannot both spend the last slot.
 */
export async function reserveUploadQuota(
  ownerId: string,
  limit: number,
): Promise<boolean> {
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
 * Releases a reservation when an upload failed before YouTube was ever
 * called. YouTube charges quota on request rather than on success, so this is
 * only correct for local failures (missing file, no channel connected).
 */
export async function releaseUploadQuota(ownerId: string): Promise<void> {
  const date = quotaDate();
  const used = await unitsUsedToday(ownerId);

  await db
    .from("quota_usage")
    .update({ units_used: Math.max(0, used - UPLOAD_COST_UNITS) })
    .eq("owner_id", ownerId)
    .eq("usage_date", date);
}
