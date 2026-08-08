/** mm:ss.d — the timecode format used everywhere in the UI. */
export function timecode(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const d = Math.floor((total % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const then = new Date(iso).getTime();
  const delta = Math.round((Date.now() - then) / 1000);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Human-readable stage label. Never says "most watched" — see README. */
export function stageLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_download: "Queued for download",
    downloading: "Downloading",
    downloaded: "Downloaded",
    analyzing: "Analyzing audio",
    analyzed: "Analyzed",
    pending_segment: "Queued for cut",
    segmented: "Cut",
    cropping: "Cropping to 9:16",
    transcribing: "Transcribing",
    ready_for_review: "Ready",
    rendering: "Burning captions",
    queued: "Queued for upload",
    uploading: "Uploading",
    uploaded: "Published",
    failed: "Failed",
    rejected: "Rejected",
  };
  return labels[status] ?? status;
}
