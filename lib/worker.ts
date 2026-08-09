/**
 * Thin client for the worker service.
 *
 * Video download, ffmpeg processing and transcription cannot run inside a
 * Vercel function — no persistent disk beyond /tmp, no ffmpeg or yt-dlp
 * binaries, and an execution ceiling far below what a 30-minute source video
 * needs. The Vercel app only ever *nudges* the worker; the worker claims jobs
 * from Supabase and writes results back itself.
 */

export interface WorkerTickResult {
  ok: boolean;
  detail: string;
}

export async function nudgeWorker(): Promise<WorkerTickResult> {
  const url = process.env.WORKER_URL;
  const secret = process.env.WORKER_SHARED_SECRET;

  if (!url || !secret) {
    return {
      ok: false,
      detail:
        "Worker is not configured. Set WORKER_URL and WORKER_SHARED_SECRET (see README).",
    };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/jobs/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      // The worker acknowledges immediately and processes in the background,
      // so this only needs to survive the handshake.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { ok: false, detail: `Worker returned ${res.status}` };
    }
    return { ok: true, detail: await res.text() };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Worker unreachable",
    };
  }
}

export interface WorkerHealth {
  configured: boolean;
  ok: boolean;
  /** A short, specific reason when ok is false. Shown to the operator verbatim. */
  reason?: string;
  /** Round-trip milliseconds, so a slow-but-alive worker is distinguishable. */
  ms?: number;
  /** How the worker was found: an HTTP probe, or a recent heartbeat. */
  via?: "http" | "heartbeat";
  /** Seconds since the most recent heartbeat, when there is one. */
  heartbeatAgeSeconds?: number;
}

/**
 * A heartbeat older than this is treated as a stopped worker.
 *
 * The worker beats every 30s at most, so three minutes tolerates a couple of
 * missed beats and a slow network without reporting a live worker as dead.
 */
const HEARTBEAT_STALE_SECONDS = 180;

/**
 * Has any worker checked in recently?
 *
 * This is the signal that makes a worker with no inbound URL a supported
 * deployment. Jobs are claimed by polling, so a worker on a laptop drains the
 * queue exactly as well as one on a public host — it simply cannot be probed.
 * It is also the stronger signal in general: an open port proves a process is
 * listening, a recent heartbeat proves it is running its loop and can reach the
 * database, which is what actually has to be true for work to happen.
 */
type HeartbeatLookup =
  | { kind: "seen"; ageSeconds: number }
  | { kind: "none" }
  | { kind: "unavailable"; detail: string };

async function lookupHeartbeat(): Promise<HeartbeatLookup> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient()
      .from("worker_heartbeats")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // A failed lookup is not the same as "nobody has checked in". Saying the
    // latter when the truth is the former sends the operator to look at their
    // worker when the problem is the table or the key.
    if (error) return { kind: "unavailable", detail: error.message };

    const seen = (data as { last_seen_at?: string } | null)?.last_seen_at;
    if (!seen) return { kind: "none" };

    return {
      kind: "seen",
      ageSeconds: Math.round((Date.now() - new Date(seen).getTime()) / 1000),
    };
  } catch (err) {
    return {
      kind: "unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ten seconds: a cold container can take most of that just to accept a socket. */
const HEALTH_TIMEOUT_MS = 10_000;

/**
 * Probes the worker and says *why* when it fails.
 *
 * A bare boolean was not enough to act on. "Unreachable" covers a wrong
 * hostname, a container that is not running, a cold start still booting, and a
 * URL that resolves to something else entirely — and those have four different
 * fixes. The failure modes are separated here so the operator is told which one
 * they have rather than being handed a checklist.
 *
 * Note that /health is deliberately unauthenticated, so nothing about the shared
 * secret can affect this result. Suggesting otherwise sends people to the wrong
 * place.
 */
export async function workerHealth(): Promise<WorkerHealth> {
  const url = process.env.WORKER_URL;

  if (!url) {
    // No inbound URL is not the same as no worker. Ask the database.
    const beat = await lookupHeartbeat();

    if (beat.kind === "seen" && beat.ageSeconds <= HEARTBEAT_STALE_SECONDS) {
      return {
        configured: true,
        ok: true,
        via: "heartbeat",
        heartbeatAgeSeconds: beat.ageSeconds,
      };
    }

    if (beat.kind === "unavailable") {
      return {
        configured: false,
        ok: false,
        reason: `WORKER_URL is not set, and the worker check-in table could not be read: ${beat.detail}`,
      };
    }

    return {
      configured: false,
      ok: false,
      reason:
        beat.kind === "none"
          ? "WORKER_URL is not set and no worker has ever checked in. Either deploy the worker somewhere reachable, or run it anywhere at all — it claims jobs by polling and will check in on its own."
          : `WORKER_URL is not set, and the last worker check-in was ${beat.ageSeconds}s ago — that worker looks stopped.`,
      heartbeatAgeSeconds: beat.kind === "seen" ? beat.ageSeconds : undefined,
    };
  }

  let target: URL;
  try {
    target = new URL(`${url.replace(/\/$/, "")}/health`);
  } catch {
    return {
      configured: true,
      ok: false,
      reason: `WORKER_URL is not a valid URL: "${url}". It should look like https://your-worker.fly.dev`,
    };
  }

  if (target.protocol !== "https:" && target.hostname !== "localhost") {
    return {
      configured: true,
      ok: false,
      reason: `WORKER_URL uses ${target.protocol}//. Use https://`,
    };
  }

  const started = Date.now();
  try {
    const res = await fetch(target, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    const ms = Date.now() - started;

    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        ms,
        reason: `${target.host} answered ${res.status}. Something is at that address, but it is not the worker — check the hostname.`,
      };
    }

    // A 200 from an unrelated service would otherwise read as success.
    const body = (await res.json().catch(() => null)) as
      | { service?: string; ok?: boolean }
      | null;

    if (body?.service !== "nexus-clips-worker") {
      return {
        configured: true,
        ok: false,
        ms,
        reason: `${target.host} answered 200 but is not the Nexus worker. WORKER_URL is probably pointing at the wrong service.`,
      };
    }

    return { configured: true, ok: true, ms, via: "http" };
  } catch (err) {
    const ms = Date.now() - started;
    const name = err instanceof Error ? err.name : "";

    // Node's fetch reports every transport failure as `TypeError: fetch failed`
    // and hides the real one on `.cause`. Reading only the outer message loses
    // exactly the detail worth showing — a refused connection and a name that
    // does not resolve are the two most common mistakes here and they look
    // identical from the outside.
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const code = cause?.code ?? "";
    const message = [
      err instanceof Error ? err.message : String(err),
      cause?.message,
      code,
    ]
      .filter(Boolean)
      .join(" ");

    if (name === "TimeoutError" || message.includes("aborted")) {
      return {
        configured: true,
        ok: false,
        ms,
        reason: `${target.host} did not answer within ${HEALTH_TIMEOUT_MS / 1000}s. If the container was asleep it may still be starting — check again in a minute.`,
      };
    }

    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message) || code === "ENOTFOUND") {
      return {
        configured: true,
        ok: false,
        ms,
        reason: `${target.host} does not resolve. Check the hostname in WORKER_URL for a typo.`,
      };
    }

    if (
      /ECONNREFUSED|ECONNRESET|socket hang up/i.test(message) ||
      code === "ECONNREFUSED"
    ) {
      return {
        configured: true,
        ok: false,
        ms,
        reason: `${target.host} refused the connection. The host is there but nothing is listening — the container is probably not running.`,
      };
    }

    if (/certificate|TLS|SSL/i.test(message)) {
      return { configured: true, ok: false, ms, reason: `TLS failed for ${target.host}: ${message}` };
    }

    return {
      configured: true,
      ok: false,
      ms,
      reason: `${target.host} could not be reached: ${cause?.message ?? message}`,
    };
  }
}
