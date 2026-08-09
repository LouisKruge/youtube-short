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
export function useWorkerState(): WorkerState {
  const [state, setState] = useState<WorkerState>("unknown");

  useEffect(() => {
    let live = true;

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok || !live) return;
        const { configured, online } = await res.json();
        if (!live) return;
        setState(!configured ? "unconfigured" : online ? "online" : "offline");
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

  return state;
}
