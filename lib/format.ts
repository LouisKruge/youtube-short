/**
 * Relative time, for "updated" columns.
 *
 * Coarse on purpose: an exact age is noise in a list being scanned, and the
 * absolute timestamp is available on hover where a row needs it.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "--";
  const delta = Math.round((Date.now() - then) / 1000);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/**
 * m:ss, for short durations where hours would be dead zeros.
 *
 * Longer figures use `hms` from components/clips/Waveform (h:mm:ss) and frame
 * timecodes use `tc` from VideoPlayer (hh:mm:ss:ff). Three formats, each with
 * one job — a clip length, a source position, and a frame.
 */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const total = Math.round(Math.max(0, seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
