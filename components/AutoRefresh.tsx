"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the current server component on an interval.
 *
 * Every screen here is `force-dynamic`, so `router.refresh()` re-reads the real
 * queries and reconciles into the existing tree — no second API surface to keep
 * in step with the page's own loader, and no flash of a loading state.
 *
 * The interval is the caller's decision because it should depend on whether
 * anything is actually moving: seconds while the worker holds a job, a minute
 * or two when the board is idle.
 */
export function AutoRefresh({
  intervalMs,
  enabled = true,
}: {
  intervalMs: number;
  enabled?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    // Refreshing a hidden tab burns database reads for a screen nobody is
    // looking at, and the visibility change triggers an immediate catch-up.
    function tick() {
      if (document.visibilityState === "visible") router.refresh();
    }

    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, enabled, router]);

  return null;
}
