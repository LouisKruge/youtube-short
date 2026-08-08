import { timecode } from "@/lib/format";

export interface RadarEntry {
  start: number;
  end: number;
  score: number;
  label: string;
}

interface Props {
  entries: RadarEntry[];
  durationSeconds: number | null;
  live?: boolean;
}

/**
 * Clip radar.
 *
 * Candidates plotted on the source timeline as the analyze pass finds them —
 * audio peaks land first, then the scored moments replace them once the
 * transcript is in. Height is the score, so a glance shows both where the
 * interesting parts are and how confident the ranking is.
 */
export function ClipRadar({ entries, durationSeconds, live = false }: Props) {
  if (!durationSeconds || entries.length === 0) return null;

  const maxScore = Math.max(1, ...entries.map((e) => e.score));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow">Clip radar</span>
        {live && (
          <span className="flex items-center gap-1.5">
            <span
              className="lamp-live block h-[5px] w-[5px] rounded-full"
              style={{ background: "var(--lamp)" }}
              aria-hidden="true"
            />
            <span className="eyebrow" style={{ color: "var(--lamp)" }}>
              scanning
            </span>
          </span>
        )}
      </div>

      <div
        className="panel-inset relative"
        style={{ height: 56 }}
        role="img"
        aria-label={`${entries.length} candidate moments across ${timecode(durationSeconds)}`}
      >
        {/* Mid-line: the timeline itself. */}
        <span
          className="absolute inset-x-0 block h-[1px]"
          style={{ bottom: 12, background: "var(--rule)" }}
        />

        {entries.map((entry, i) => {
          const left = (entry.start / durationSeconds) * 100;
          const height = 8 + (entry.score / maxScore) * 34;
          const hot = entry.score >= maxScore * 0.75;

          return (
            <span
              key={`${entry.start}-${i}`}
              title={`${timecode(entry.start)} — ${entry.label} (${Math.round(entry.score)})`}
              className="absolute block w-[3px] rounded-t-[1px]"
              style={{
                left: `${Math.min(99.5, left)}%`,
                bottom: 12,
                height,
                background: hot ? "var(--lamp)" : "var(--synth)",
                opacity: hot ? 0.95 : 0.6,
              }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex justify-between">
        <span className="tc text-[10px] text-dim">00:00.0</span>
        <span className="eyebrow">{entries.length} candidates</span>
        <span className="tc text-[10px] text-dim">{timecode(durationSeconds)}</span>
      </div>
    </div>
  );
}
