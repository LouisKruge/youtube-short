"use client";

import { cn } from "@/components/ui/cn";

export interface CropSegment {
  /** Seconds from the clip start. */
  t: number;
  /** Horizontal centre of interest, 0..1 across the source frame. */
  center: number;
}

export interface CropTrackData {
  segments: CropSegment[];
  static: boolean;
  method: string;
}

/**
 * The crop path.
 *
 * Plots where the 9:16 window sits across the source frame over the clip's
 * duration — vertical axis is horizontal position, which reads oddly for a
 * second and then reads exactly right, because the picture is "how far left or
 * right is the framing at each moment".
 *
 * Drawn as a stepped line, not a curve, because the worker holds each segment
 * piecewise-constant. A smooth interpolation here would misrepresent what
 * ffmpeg is actually doing to the frame.
 */
export function CropTrackChart({
  track,
  durationSeconds,
  playhead,
  height = 34,
  className,
}: {
  track: CropTrackData | null;
  durationSeconds: number;
  /** Seconds from the clip start. */
  playhead?: number | null;
  height?: number;
  className?: string;
}) {
  if (!track || track.method !== "motion" || track.segments.length === 0) {
    return (
      <div
        className={cn("well flex items-center justify-between px-2", className)}
        style={{ height }}
      >
        <span className="t-label">crop</span>
        <span className="t-label text-fg-3">
          {track?.static ? "held centred" : "centre, no tracking"}
        </span>
      </div>
    );
  }

  const width = 1000;
  const inset = 4;
  const usable = height - inset * 2;

  // Stepped path: hold each centre until the next segment's time.
  const points: string[] = [];
  track.segments.forEach((segment, i) => {
    const x = (Math.min(segment.t, durationSeconds) / durationSeconds) * width;
    const y = inset + segment.center * usable;
    if (i === 0) points.push(`${x},${y}`);
    else {
      const previous = points[points.length - 1].split(",");
      points.push(`${x},${previous[1]}`);
      points.push(`${x},${y}`);
    }
  });
  const last = points[points.length - 1]?.split(",")[1];
  if (last) points.push(`${width},${last}`);

  return (
    <div
      className={cn("well relative overflow-hidden", className)}
      style={{ height }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label={`Crop position across the clip, ${track.segments.length} moves`}
      >
        {/* Frame centre — the reference a static crop would hold. */}
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--line)"
          strokeWidth="0.75"
          strokeDasharray="4 4"
        />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--fg-2)"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span className="t-label absolute left-2 top-1 text-fg-4">L</span>
      <span className="t-label absolute bottom-1 left-2 text-fg-4">R</span>

      {playhead != null && durationSeconds > 0 && (
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
