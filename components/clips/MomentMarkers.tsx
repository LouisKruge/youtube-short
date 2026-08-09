"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { hms } from "./Waveform";

export interface Moment {
  start: number;
  end: number;
  score: number;
  label: string;
  /** Present once the moment has become a clip. */
  clipId?: string;
  rank?: number | null;
}

/** Score bands. Named for where a moment sits in the ranking, nothing more. */
export function band(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

const STEM: Record<ReturnType<typeof band>, string> = {
  high: "bg-fg",
  medium: "bg-fg-2",
  low: "bg-fg-4",
};

/**
 * The detection strip: every candidate moment on the source timeline.
 *
 * A moment is a stem with a cap — a vertical rule from the floor and a square
 * head at its height. Height and brightness both encode score, so the shape of
 * the whole episode is readable in one pass, and the three bands stay apart
 * even at a glance.
 *
 * Hovering lifts a readout with the score, the band and the timecode. Clicking
 * seeks, or opens the clip if the moment has become one.
 */
export function MomentMarkers({
  moments,
  durationSeconds,
  height = 52,
  activeStart,
  onSelect,
  className,
}: {
  moments: Moment[];
  durationSeconds: number | null;
  height?: number;
  /** Start time of the moment currently being previewed. */
  activeStart?: number | null;
  onSelect?: (moment: Moment) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!durationSeconds || moments.length === 0) {
    return (
      <div
        className={cn("well flex items-center justify-center", className)}
        style={{ height }}
      >
        <span className="t-label">no candidates yet</span>
      </div>
    );
  }

  const peak = Math.max(1, ...moments.map((m) => m.score));
  const floor = 10; // Stem minimum, so a low-scoring moment is still findable.

  return (
    <div className={cn("relative", className)}>
      <div className="well relative overflow-hidden" style={{ height }}>
        {/* The floor the stems stand on. */}
        <span className="absolute inset-x-0 bottom-2 block h-px bg-line" />

        {moments.map((moment, i) => {
          const left = Math.min(99.6, (moment.start / durationSeconds) * 100);
          const stem = floor + (moment.score / peak) * (height - 14 - floor);
          const tier = band(moment.score);
          const isActive =
            activeStart != null && Math.abs(activeStart - moment.start) < 0.5;
          const isHover = hover === i;

          return (
            <button
              key={`${moment.start}-${i}`}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={onSelect ? () => onSelect(moment) : undefined}
              aria-label={`${moment.label} at ${hms(moment.start)}, score ${Math.round(moment.score)}`}
              // The hit area is 9px wide while the mark is 1px — a 1px target
              // is unusable, and the padding is invisible.
              className="absolute bottom-0 top-0 -ml-[4px] w-[9px]"
              style={{ left: `${left}%` }}
            >
              <span
                className={cn(
                  "absolute bottom-2 left-[4px] block w-px transition-all duration-fast ease-ease",
                  isActive || isHover ? "bg-fg" : STEM[tier],
                )}
                style={{ height: stem }}
              />
              <span
                className={cn(
                  "absolute left-[2.5px] block h-[3px] w-[3px] transition-all duration-fast ease-ease",
                  isActive || isHover ? "bg-fg" : STEM[tier],
                )}
                style={{ bottom: stem + 6 }}
              />
              {isActive && (
                <span className="absolute bottom-0 left-[4px] block h-[4px] w-px bg-fg" />
              )}
            </button>
          );
        })}
      </div>

      {/* Readout. Fixed height and reserved space, so the strip does not shift
          the layout when the pointer crosses it. */}
      <div className="mt-1 flex h-4 items-baseline justify-between">
        {hover != null ? (
          <>
            <span className="flex items-baseline gap-2">
              <span className="t-figure text-md text-fg">
                {Math.round(moments[hover].score)}
              </span>
              <span className="t-label text-fg-2">
                {band(moments[hover].score)}
              </span>
              <span className="t-label truncate">{moments[hover].label}</span>
            </span>
            <span className="t-num text-2xs text-fg-2">
              {hms(moments[hover].start)}
            </span>
          </>
        ) : (
          <>
            <span className="t-label">
              {moments.length} candidate{moments.length === 1 ? "" : "s"}
            </span>
            <span className="t-num text-2xs text-fg-4">{hms(durationSeconds)}</span>
          </>
        )}
      </div>
    </div>
  );
}
