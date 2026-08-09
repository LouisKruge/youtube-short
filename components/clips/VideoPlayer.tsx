"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/Button";
import { hms } from "./Waveform";

/** hh:mm:ss:ff at 30fps — the timecode a post-production tool shows. */
export function tc(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--:--:--";
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * 30);
  return [h, m, s, f].map((n) => String(n).padStart(2, "0")).join(":");
}

const FRAME = 1 / 30;

export interface PlayerHandle {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * The player.
 *
 * Transport is a single 32px bar under the image: play, frame step, timecode,
 * duration, volume, fullscreen. No overlay controls fading in and out over the
 * picture — a monitor's chrome does not move, and an operator scrubbing a
 * timeline needs the buttons to stay where they were.
 *
 * The scrub bar is the caller's business: whatever is passed as `timeline` sits
 * directly beneath the transport, which is how the source waveform, the moment
 * markers and the caption track all share one playhead.
 */
export function VideoPlayer({
  src,
  poster,
  vertical,
  label,
  onTime,
  onReady,
  handleRef,
  timeline,
  className,
}: {
  src: string | null;
  poster?: string | null;
  /** Letterbox to 9:16 rather than filling the frame. */
  vertical?: boolean;
  label?: string;
  onTime?: (seconds: number) => void;
  onReady?: (durationSeconds: number) => void;
  handleRef?: React.MutableRefObject<PlayerHandle | null>;
  timeline?: React.ReactNode;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  // Expose an imperative handle so the timeline, the moment strip and the clip
  // list can all drive one element without lifting playback into React state.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      seek(seconds) {
        const el = video.current;
        if (!el) return;
        el.currentTime = Math.max(0, seconds);
        setTime(el.currentTime);
      },
      play: () => void video.current?.play(),
      pause: () => video.current?.pause(),
    };
  }, [handleRef]);

  const step = useCallback((delta: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
    setTime(el.currentTime);
  }, []);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  // Scoped to the player: these keys only apply while it holds focus, so they
  // never fight the shell's section shortcuts.
  function onKeyDown(e: React.KeyboardEvent) {
    const el = video.current;
    if (!el) return;

    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(e.shiftKey ? -10 : -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(e.shiftKey ? 10 : 1);
    } else if (e.key === ",") {
      e.preventDefault();
      step(-FRAME);
    } else if (e.key === ".") {
      e.preventDefault();
      step(FRAME);
    } else if (e.key === "m") {
      e.preventDefault();
      el.muted = !el.muted;
      setMuted(el.muted);
    }
  }

  return (
    <div
      ref={shell}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn("flex min-h-0 flex-col outline-none", className)}
      aria-label={label ?? "Video preview"}
    >
      <div
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-sunken",
          vertical && "px-4",
        )}
      >
        {src ? (
          <video
            ref={video}
            src={src}
            poster={poster ?? undefined}
            preload="metadata"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setTime(t);
              onTime?.(t);
            }}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setLength(d);
              onReady?.(d);
            }}
            onClick={toggle}
            className={cn(
              "max-h-full cursor-pointer",
              vertical ? "h-full w-auto" : "h-full w-full object-contain",
            )}
          />
        ) : (
          // Not an error and not a spinner: the source is on the worker's disk
          // and simply is not fetchable yet. The dashed 9:16 guide keeps the
          // region reading as a monitor with nothing on it rather than as a
          // large empty area the layout forgot about.
          <div
            className="flex h-full max-h-full flex-col items-center justify-center gap-2 border border-dashed border-line px-6"
            style={{ aspectRatio: vertical ? "9 / 16" : "16 / 9" }}
          >
            <span className="t-label">no signal</span>
            <span className="max-w-[26ch] text-center text-xs leading-relaxed text-fg-4">
              The media has not finished rendering, or it is still only on the
              worker.
            </span>
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="flex h-8 shrink-0 items-center gap-1 rule-t bg-raised px-2">
        <IconButton
          label={playing ? "Pause" : "Play"}
          size="sm"
          onClick={toggle}
          disabled={!src}
        >
          {playing ? (
            <Pause size={12} strokeWidth={1.5} />
          ) : (
            <Play size={12} strokeWidth={1.5} />
          )}
        </IconButton>
        <IconButton
          label="Back one second"
          size="sm"
          onClick={() => step(-1)}
          disabled={!src}
        >
          <SkipBack size={12} strokeWidth={1.5} />
        </IconButton>
        <IconButton
          label="Forward one second"
          size="sm"
          onClick={() => step(1)}
          disabled={!src}
        >
          <SkipForward size={12} strokeWidth={1.5} />
        </IconButton>

        <span className="mx-1.5 block h-3.5 w-px bg-line" aria-hidden="true" />

        <span className="t-num text-xs text-fg" aria-label="Current timecode">
          {tc(time)}
        </span>
        <span className="t-num text-xs text-fg-4">/ {hms(length || null)}</span>

        <span className="ml-auto flex items-center gap-1">
          <IconButton
            label={muted ? "Unmute" : "Mute"}
            size="sm"
            onClick={() => {
              const el = video.current;
              if (!el) return;
              el.muted = !el.muted;
              setMuted(el.muted);
            }}
            disabled={!src}
          >
            {muted ? (
              <VolumeX size={12} strokeWidth={1.5} />
            ) : (
              <Volume2 size={12} strokeWidth={1.5} />
            )}
          </IconButton>
          <IconButton
            label="Fullscreen"
            size="sm"
            onClick={() => void shell.current?.requestFullscreen?.()}
            disabled={!src}
          >
            <Maximize2 size={12} strokeWidth={1.5} />
          </IconButton>
        </span>
      </div>

      {timeline && <div className="shrink-0 rule-t bg-bg px-3 py-2.5">{timeline}</div>}
    </div>
  );
}
