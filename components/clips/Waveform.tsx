"use client";

import { useMemo, useRef } from "react";
import { cn } from "@/components/ui/cn";

export interface Window {
  start: number;
  end: number;
  /** Draw as the current selection rather than as one of many. */
  active?: boolean;
  label?: string;
}

/**
 * The audio envelope, drawn as a centred waveform.
 *
 * This is the one honest picture of how candidates are found: loudness over
 * time against its own rolling baseline. Samples that exceed the baseline are
 * drawn a step brighter, which is literally the signal the picker keys on — if
 * the display is flat, the picker had nothing to work with, and that is worth
 * being able to see before wondering why the clips are poor.
 *
 * Clicking seeks. That makes the waveform a control, not an illustration.
 */

/** Minimum drawn width, in viewBox units, for a clip window. */
const MIN_MARK = 6;

export function Waveform({
  envelope,
  durationSeconds,
  windows = [],
  scenes = [],
  playhead,
  height = 44,
  onSeek,
  className,
}: {
  envelope: number[] | null;
  durationSeconds: number | null;
  windows?: Window[];
  /** Scene-boundary times, drawn as ticks along the floor. */
  scenes?: number[];
  playhead?: number | null;
  height?: number;
  onSeek?: (seconds: number) => void;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);

  const bars = useMemo(() => {
    if (!envelope || envelope.length === 0) return null;

    // dBFS lands roughly in -60..0. Anything under -55 is room tone.
    const floor = -55;
    const scaled = envelope.map((db) => {
      const clamped = Math.max(floor, Math.min(0, db));
      return (clamped - floor) / -floor;
    });

    // Aggregate to a fixed bar count before drawing. A two-hour source can
    // arrive with a thousand samples; drawn one-to-one they land under a pixel
    // each and the result is a grey barcode that reads as decoration. Taking the
    // peak of each bucket keeps the loud moments — which is the whole point of
    // the display — while leaving air between bars.
    const BUCKETS = 132;
    const size = Math.max(1, Math.ceil(scaled.length / BUCKETS));
    const normalized: number[] = [];
    for (let i = 0; i < scaled.length; i += size) {
      normalized.push(Math.max(...scaled.slice(i, i + size)));
    }

    // The same rolling baseline the worker's picker measures against, computed
    // on the aggregated series so the comparison matches what is drawn.
    const span = Math.max(2, Math.round(normalized.length / 18));
    const baseline = normalized.map((_, i) => {
      const from = Math.max(0, i - span);
      const to = Math.min(normalized.length, i + span + 1);
      const slice = normalized.slice(from, to);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    return { normalized, baseline };
  }, [envelope]);

  function seek(e: React.MouseEvent) {
    if (!onSeek || !durationSeconds) return;
    const box = wrap.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    onSeek(ratio * durationSeconds);
  }

  if (!bars || !durationSeconds) {
    return (
      <div
        className={cn("well flex items-center justify-center", className)}
        style={{ height }}
      >
        <span className="t-label">no envelope yet</span>
      </div>
    );
  }

  const width = 1000;
  const step = width / bars.normalized.length;
  const inset = 6;
  const usable = height - inset * 2;

  return (
    <div
      ref={wrap}
      onClick={onSeek ? seek : undefined}
      className={cn(
        "well relative overflow-hidden",
        onSeek && "cursor-col-resize",
        className,
      )}
      style={{ height }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label={`Audio energy over ${Math.round(durationSeconds)} seconds, with ${windows.length} clip window${windows.length === 1 ? "" : "s"}`}
      >
        {/* Window fills sit under the signal so they read as regions of it. */}
        {windows.map((w, i) => {
          const x = (w.start / durationSeconds) * width;
          // MIN_MARK: a 30-second window inside a two-hour source is 0.4% of
          // the width. Without a floor the one thing this display exists to
          // show -- where the clips came from -- is sub-pixel and invisible.
          const w2 = Math.max(
            MIN_MARK,
            ((w.end - w.start) / durationSeconds) * width,
          );
          return (
            <rect
              key={`fill-${i}`}
              x={x}
              y={0}
              width={w2}
              height={height}
              fill="var(--fg)"
              opacity={w.active ? 0.16 : 0.07}
            />
          );
        })}

        {bars.normalized.map((value, i) => {
          const barHeight = Math.max(1, value * usable);
          const over = value > bars.baseline[i] * 1.18;
          return (
            <rect
              key={i}
              x={i * step + step * 0.2}
              y={(height - barHeight) / 2}
              width={step * 0.6}
              height={barHeight}
              fill={over ? "var(--fg-2)" : "var(--fg-4)"}
            />
          );
        })}

        {/* Baseline: the threshold, dashed so it never reads as signal. */}
        <polyline
          points={bars.baseline
            .map((v, i) => `${i * step},${height / 2 - (v * usable) / 2}`)
            .join(" ")}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth="0.75"
          strokeDasharray="4 4"
        />

        {/* Window edges: 1px rules, brighter for the active one. */}
        {windows.map((w, i) => {
          const x = (w.start / durationSeconds) * width;
          const w2 = Math.max(
            MIN_MARK,
            ((w.end - w.start) / durationSeconds) * width,
          );
          const stroke = w.active ? "var(--fg)" : "var(--fg-3)";
          return (
            <g key={`edge-${i}`}>
              {/* A cap along the top edge: at this scale the bracket is what
                  is legible, not the two side rules on their own. */}
              <rect x={x} y={0} width={w2} height={1.2} fill={stroke} />
              <rect x={x} y={0} width={0.9} height={height} fill={stroke} />
              <rect
                x={x + w2 - 0.9}
                y={0}
                width={0.9}
                height={height}
                fill={stroke}
              />
            </g>
          );
        })}

        {/* Scene cuts: 3px ticks on the floor. Structure, not emphasis. */}
        {scenes.map((t, i) => (
          <rect
            key={`scene-${i}`}
            x={(t / durationSeconds) * width}
            y={height - 3}
            width={0.8}
            height={3}
            fill="var(--fg-4)"
          />
        ))}
      </svg>

      {/* Playhead is a DOM element, not SVG: it moves every frame, and this way
          only its transform is touched. */}
      {playhead != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-fg"
          style={{
            left: `${Math.max(0, Math.min(100, (playhead / durationSeconds) * 100))}%`,
          }}
        />
      )}
    </div>
  );
}

/**
 * The scale strip under a waveform: start, a caption, and end. Mono figures so
 * the two ends align with every other timecode in the interface.
 */
export function TimeScale({
  durationSeconds,
  caption,
  className,
}: {
  durationSeconds: number | null;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={cn("mt-1 flex items-baseline justify-between", className)}>
      <span className="t-num text-2xs text-fg-4">00:00:00</span>
      {caption && <span className="t-label">{caption}</span>}
      <span className="t-num text-2xs text-fg-4">
        {hms(durationSeconds)}
      </span>
    </div>
  );
}

/** h:mm:ss — the format used for source-length figures. */
export function hms(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--:--";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
