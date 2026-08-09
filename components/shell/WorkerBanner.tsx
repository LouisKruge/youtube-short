"use client";

import Link from "next/link";
import { useWorkerState } from "./useWorkerState";

/**
 * The stuck-work banner.
 *
 * Without this, a source sitting at "queued" with no worker looks exactly like a
 * source the worker is patiently working on: same status chip, same empty
 * panels, same spinner-free calm. The operator waits for something that can
 * never happen, and the only clue is a 5px dot in the sidebar footer.
 *
 * It reports the probe's actual finding rather than a checklist. The first
 * version of this suggested checking that WORKER_SHARED_SECRET matched on both
 * sides — which cannot be the cause, because /health is unauthenticated. A
 * secret mismatch lets health pass and only makes nudges 401. Guessing at
 * causes in an alarm is worse than saying less.
 */
export function WorkerBanner({ pending }: { pending: number }) {
  const { state, reason } = useWorkerState();

  // "unknown" is the first second after mount, before the health check lands.
  // Flashing an alarm during it would train the operator to ignore the alarm.
  if (pending === 0 || state === "online" || state === "unknown") return null;

  const unconfigured = state === "unconfigured";

  return (
    <div
      role="status"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-s2 px-4 py-2.5"
    >
      <span
        aria-hidden="true"
        className="mt-[5px] block h-[6px] w-[6px] shrink-0 self-start bg-fg"
      />

      <span className="t-label shrink-0 text-fg">
        {unconfigured ? "no worker configured" : "worker unreachable"}
      </span>

      <span className="min-w-0 flex-1 text-sm leading-relaxed text-fg-2">
        {pending === 1 ? "One job is" : `${pending} jobs are`} waiting and nothing
        is running to pick {pending === 1 ? "it" : "them"} up.{" "}
        {unconfigured ? (
          <>
            The Vercel deployment has no{" "}
            <span className="t-num text-fg">WORKER_URL</span>, so downloading,
            cutting, captioning and uploading cannot happen at all — none of it
            runs on Vercel.
          </>
        ) : (
          // The probe's own words. Every branch of it names one specific cause.
          <span className="text-fg">{reason ?? "The worker did not answer."}</span>
        )}
      </span>

      <Link
        href="/settings"
        className="shrink-0 text-xs text-fg-3 underline underline-offset-4 transition-colors duration-fast hover:text-fg"
      >
        Settings
      </Link>
    </div>
  );
}
