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

export async function workerHealth(): Promise<boolean> {
  const url = process.env.WORKER_URL;
  if (!url) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
