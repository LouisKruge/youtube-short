"use client";

import { useMemo } from "react";
import { cn } from "@/components/ui/cn";
import type { DeadSpan, TranscriptWord } from "@/lib/types";

/**
 * The caption track.
 *
 * Every word Whisper timed, laid on the clip's own timeline as a block. The
 * block widths are the real word durations, which makes the shape of the speech
 * legible at a glance — a dense run reads as fast delivery, a gap reads as a
 * pause, and that is exactly what the caption timing will look like burned in.
 *
 * The word under the playhead lifts to full brightness. This is a display, not
 * an editor: the words come from the transcript the renderer will use, so what
 * is shown here is what will be on the clip.
 */
export function CaptionTrack({
  words,
  clipStart,
  clipEnd,
  playhead,
  deadTime = [],
  height = 22,
  onSeek,
  className,
}: {
  words: TranscriptWord[];
  clipStart: number;
  clipEnd: number;
  /** Absolute source time, as reported by the player. */
  playhead?: number | null;
  deadTime?: DeadSpan[];
  height?: number;
  onSeek?: (seconds: number) => void;
  className?: string;
}) {
  const span = Math.max(0.1, clipEnd - clipStart);

  const blocks = useMemo(
    () =>
      words
        .filter((w) => w.end > clipStart && w.start < clipEnd)
        .map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          left: ((w.start - clipStart) / span) * 100,
          width: Math.max(0.35, ((w.end - w.start) / span) * 100),
        })),
    [words, clipStart, clipEnd, span],
  );

  if (blocks.length === 0) {
    return (
      <div
        className={cn("well flex items-center justify-center", className)}
        style={{ height }}
      >
        <span className="t-label">no transcript for this window</span>
      </div>
    );
  }

  const cursor = playhead != null ? playhead : null;

  return (
    <div
      className={cn("well relative overflow-hidden", className)}
      style={{ height }}
      role="img"
      aria-label={`${blocks.length} timed words across this clip`}
    >
      {/* Dead time first, so word blocks sit on top of the region they span. */}
      {deadTime.map((span_, i) => {
        const left = ((span_.start - clipStart) / span) * 100;
        const width = ((span_.end - span_.start) / span) * 100;
        if (width <= 0) return null;
        return (
          <span
            key={`dead-${i}`}
            title={`${span_.reason === "silence" ? "Silence" : "Static frame"} — removed`}
            className="absolute inset-y-0 block bg-s3"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {/* Hatch marks read as "cut" without needing a colour. */}
            <span
              className="absolute inset-0 block opacity-60"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-45deg, var(--line-strong) 0 1px, transparent 1px 4px)",
              }}
            />
          </span>
        );
      })}

      {blocks.map((block, i) => {
        const active =
          cursor != null && cursor >= block.start && cursor < block.end;
        return (
          <button
            key={`${block.start}-${i}`}
            type="button"
            title={`${block.word.trim()} · ${block.start.toFixed(2)}s`}
            onClick={onSeek ? () => onSeek(block.start) : undefined}
            className={cn(
              "absolute top-1/2 block h-[8px] -translate-y-1/2 rounded-sm transition-colors duration-fast ease-ease",
              active ? "bg-fg" : "bg-fg-4 hover:bg-fg-3",
            )}
            style={{ left: `${block.left}%`, width: `${block.width}%` }}
          >
            <span className="sr-only">{block.word}</span>
          </button>
        );
      })}

      {cursor != null && cursor >= clipStart && cursor <= clipEnd && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-fg"
          style={{ left: `${((cursor - clipStart) / span) * 100}%` }}
        />
      )}
    </div>
  );
}

/**
 * The caption text as it will read, with the word under the playhead marked.
 *
 * Set at the size captions are actually reviewed at rather than in a code
 * block — the question being answered is "does this line scan", and that needs
 * the words at reading size.
 */
export function CaptionReadout({
  words,
  clipStart,
  clipEnd,
  playhead,
  className,
}: {
  words: TranscriptWord[];
  clipStart: number;
  clipEnd: number;
  playhead?: number | null;
  className?: string;
}) {
  const inWindow = words.filter((w) => w.end > clipStart && w.start < clipEnd);

  if (inWindow.length === 0) {
    return (
      <p className={cn("text-xs text-fg-4", className)}>
        No words timed in this window.
      </p>
    );
  }

  return (
    <p className={cn("text-sm leading-relaxed", className)}>
      {inWindow.map((word, i) => {
        const active =
          playhead != null && playhead >= word.start && playhead < word.end;
        return (
          <span
            key={`${word.start}-${i}`}
            className={cn(
              "transition-colors duration-fast",
              active ? "text-fg" : "text-fg-3",
            )}
          >
            {word.word}
            {i < inWindow.length - 1 ? " " : ""}
          </span>
        );
      })}
    </p>
  );
}
