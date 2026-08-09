"use client";

import { useEffect, useState } from "react";

export type WorkerState = "unknown" | "online" | "offline" | "unconfigured";

export const WORKER_COPY: Record<WorkerState, { label: string; title: string }> = {
  unknown: { label: "worker · checking", title: "Checking the worker service" },
  online: {
    label: "worker · online",
    title: "Worker reachable — ffmpeg, yt-dlp and Whisper run there",
  },
  offline: {
    label: "worker · offline",
    title:
      "Worker unreachable. Nothing will download, cut or render until it is back up.",
  },
  unconfigured: {
    label: "worker · not set",
    title: "WORKER_URL is not configured for this deployment.",
  },
};

/**
 * Worker reachability, polled rather than rendered server-side.
 *
 * A minute is the right interval: long enough that it costs nothing, short
 * enough that an operator who just brought the worker up sees it turn over
 * before they go looking for why.
 *
 * The result is shared between the sidebar indicator and the banner, so the two
 * cannot disagree and the page still only makes one request.
 */
export interface WorkerReading {
  state: WorkerState;
  /** The specific failure, straight from the probe. Null while healthy. */
  reason: string | null;
  /** How it was found — an HTTP probe, or a heartbeat from a polling worker. */
  via: "http" | "heartbeat" | null;
}

export function useWorkerState(): WorkerReading {
  const [reading, setReading] = useState<WorkerReading>({
    state: "unknown",
    reason: null,
    via: null,
  });

  useEffect(() => {
    let live = true;

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok || !live) return;
        const { configured, online, reason, via } = await res.json();
        if (!live) return;
        setReading({
          state: !configured ? "unconfigured" : online ? "online" : "offline",
          reason: online ? null : (reason ?? null),
          via: via ?? null,
        });
      } catch {
        // Leave the last known reading rather than flapping to offline on a
        // single dropped request.
      }
    }

    check();
    const timer = setInterval(check, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return reading;
}
