import { stageLabel } from "@/lib/format";

const IN_FLIGHT = new Set([
  "downloading",
  "analyzing",
  "cropping",
  "transcribing",
  "rendering",
  "uploading",
]);

const COLORS: Record<string, string> = {
  uploaded: "var(--live)",
  ready_for_review: "var(--lamp)",
  queued: "var(--lamp)",
  failed: "var(--peak)",
  rejected: "var(--dim)",
};

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? (IN_FLIGHT.has(status) ? "var(--lamp)" : "var(--dim)");
  const live = IN_FLIGHT.has(status);

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`block h-[6px] w-[6px] rounded-full ${live ? "lamp-live" : ""}`}
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="eyebrow" style={{ color }}>
        {stageLabel(status)}
      </span>
    </span>
  );
}
