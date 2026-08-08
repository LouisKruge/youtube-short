import { timecode } from "@/lib/format";

interface Window {
  start: number;
  end: number;
  active?: boolean;
}

interface Props {
  /** dBFS samples across the whole source, evenly spaced. */
  envelope: number[] | null;
  durationSeconds: number | null;
  /** Detected clip windows, drawn as brackets over the ribbon. */
  windows?: Window[];
  height?: number;
  showScale?: boolean;
}

/**
 * The loudness ribbon.
 *
 * This is the one honest picture of how the pipeline chooses clips: loudness
 * over time, with the windows it cut bracketed on top. It is drawn from the
 * real analysis envelope, not decoration — if the ribbon is flat, the picker
 * had nothing to work with, and the operator can see that at a glance.
 */
export function LoudnessRibbon({
  envelope,
  durationSeconds,
  windows = [],
  height = 44,
  showScale = false,
}: Props) {
  if (!envelope || envelope.length === 0 || !durationSeconds) {
    return (
      <div
        className="panel-inset flex items-center justify-center"
        style={{ height }}
      >
        <span className="eyebrow">Awaiting analysis</span>
      </div>
    );
  }

  // Normalise dBFS (roughly -60..0) to 0..1.
  const floor = -55;
  const normalized = envelope.map((db) => {
    const clamped = Math.max(floor, Math.min(0, db));
    return (clamped - floor) / -floor;
  });

  // Rolling baseline — the same signal the worker's peak picker uses.
  const windowSize = Math.max(3, Math.round(normalized.length / 24));
  const baseline = normalized.map((_, i) => {
    const from = Math.max(0, i - windowSize);
    const to = Math.min(normalized.length, i + windowSize + 1);
    const slice = normalized.slice(from, to);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const width = 1000;
  const step = width / normalized.length;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full panel-inset"
        style={{ height }}
        role="img"
        aria-label={`Audio energy across ${timecode(durationSeconds)} of source, with ${windows.length} detected high-energy window${windows.length === 1 ? "" : "s"}`}
      >
        {/* Energy bars, centred on the mid-line like a waveform monitor. */}
        {normalized.map((value, i) => {
          const barHeight = Math.max(1, value * (height - 8));
          const isOver = value > baseline[i] * 1.22;
          return (
            <rect
              key={i}
              x={i * step}
              y={(height - barHeight) / 2}
              width={Math.max(0.6, step * 0.72)}
              height={barHeight}
              fill={isOver ? "var(--lamp)" : "var(--rule)"}
              opacity={isOver ? 0.95 : 0.75}
            />
          );
        })}

        {/* Rolling baseline: the threshold peaks are measured against. */}
        <polyline
          points={baseline
            .map((v, i) => `${i * step},${height / 2 - (v * (height - 8)) / 2}`)
            .join(" ")}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="0.8"
          strokeDasharray="3 3"
          opacity={0.5}
        />

        {/* Cut windows, bracketed over the signal they were chosen from. */}
        {windows.map((w, i) => {
          const x = (w.start / durationSeconds) * width;
          const w2 = Math.max(2, ((w.end - w.start) / durationSeconds) * width);
          const color = w.active ? "var(--lamp)" : "var(--synth)";
          return (
            <g key={i}>
              <rect
                x={x}
                y={0}
                width={w2}
                height={height}
                fill={color}
                opacity={w.active ? 0.16 : 0.09}
              />
              <rect x={x} y={0} width={1} height={height} fill={color} />
              <rect x={x + w2 - 1} y={0} width={1} height={height} fill={color} />
            </g>
          );
        })}
      </svg>

      {showScale && (
        <div className="mt-1 flex justify-between">
          <span className="tc text-[10px] text-dim">00:00.0</span>
          <span className="eyebrow">Audio energy</span>
          <span className="tc text-[10px] text-dim">{timecode(durationSeconds)}</span>
        </div>
      )}
    </div>
  );
}
