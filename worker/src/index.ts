import express from "express";
import { hostname } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";
import { log } from "./log.js";
import { drain } from "./pipeline/index.js";
import { ensureMediaDir } from "./storage.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

/** Only one drain runs at a time; extra nudges are a no-op while it works. */
let draining = false;

/**
 * Identity for the heartbeat. Stable across restarts on the same box, so a
 * worker that crashes and comes back updates its row rather than leaving a
 * trail of dead ones.
 */
const WORKER_ID = process.env.WORKER_ID ?? hostname();

/**
 * Tells the dashboard this worker is alive.
 *
 * The app cannot always reach the worker — running it on a laptop, behind NAT,
 * or on a host with no inbound routing is a perfectly good deployment, because
 * jobs are claimed by polling rather than pushed. Without this the dashboard
 * would report "no worker configured" while work was actively being processed.
 *
 * Best-effort by design: a heartbeat that fails must never stop a drain. If the
 * database is unreachable the worker has bigger problems, and they will surface
 * in the drain itself.
 */
async function heartbeat(): Promise<void> {
  try {
    await db.from("worker_heartbeats").upsert(
      {
        worker_id: WORKER_ID,
        last_seen_at: new Date().toISOString(),
        detail: {
          pollIntervalMs: config.pollIntervalMs,
          transcriptionEnabled: config.transcriptionEnabled,
          startedAt: STARTED_AT,
        },
      },
      { onConflict: "worker_id" },
    );
  } catch (err) {
    log.warn("Heartbeat failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const STARTED_AT = new Date().toISOString();

async function drainOnce(trigger: string): Promise<void> {
  if (draining) {
    log.info("Drain already in progress", { trigger });
    return;
  }

  draining = true;
  const startedAt = Date.now();

  // Before the work, not after: a drain that takes twenty minutes on a long
  // source would otherwise let the heartbeat go stale and the dashboard would
  // report the worker dead at exactly the moment it is busiest.
  await heartbeat();

  try {
    const handled = await drain();
    if (handled > 0) {
      log.info("Drain complete", {
        trigger,
        handled,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    }
  } catch (err) {
    log.error("Drain crashed", {
      trigger,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    draining = false;
  }
}

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.sharedSecret);
  // Constant-time compare; length must match first or timingSafeEqual throws.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, draining, service: "nexus-clips-worker" });
});

app.post("/jobs/run", (req, res) => {
  if (!authorized(req.header("authorization"))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Acknowledge immediately — the caller is a Vercel function that must not
  // sit blocked for the minutes an ffmpeg pass can take.
  res.json({ ok: true, accepted: true, draining });
  void drainOnce("nudge");
});

async function main() {
  await ensureMediaDir();

  app.listen(config.port, () => {
    log.info("Worker listening", {
      port: config.port,
      renderBothCaptionStyles: config.renderBothCaptionStyles,
      transcriptionEnabled: config.transcriptionEnabled,
    });
  });

  // Self-poll as a safety net: if a nudge is lost, or the app is down, queued
  // work still gets picked up eventually.
  setInterval(() => void drainOnce("poll"), config.pollIntervalMs);

  // A separate, faster beat so a long drain cannot look like a dead worker.
  setInterval(
    () => void heartbeat(),
    Math.min(30_000, Math.max(5_000, Math.floor(config.pollIntervalMs / 2))),
  );

  void drainOnce("startup");
}

main().catch((err) => {
  log.error("Worker failed to start", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
