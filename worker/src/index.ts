import express from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { log } from "./log.js";
import { drain } from "./pipeline/index.js";
import { ensureMediaDir } from "./storage.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

/** Only one drain runs at a time; extra nudges are a no-op while it works. */
let draining = false;

async function drainOnce(trigger: string): Promise<void> {
  if (draining) {
    log.info("Drain already in progress", { trigger });
    return;
  }

  draining = true;
  const startedAt = Date.now();

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
  void drainOnce("startup");
}

main().catch((err) => {
  log.error("Worker failed to start", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
