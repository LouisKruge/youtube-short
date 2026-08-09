import { createHmac, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { ffprobe } from "./exec.js";
import { log } from "./log.js";
import { LOCAL_PREFIX } from "./storage.js";

/**
 * Direct browser-to-worker upload.
 *
 * Source video used to go to Supabase Storage, which caps a single file at 50 MB
 * on the free plan — about 75 seconds of 1080p. The browser now sends the file
 * straight to this machine's volume instead, so the ceiling is disk rather than
 * a plan, and the bytes cross the network once rather than twice.
 *
 * The browser cannot hold WORKER_SHARED_SECRET, so it carries a short-lived
 * token the app mints with it: an HMAC over the source id and an expiry. That
 * grants the ability to write one specific source's file for a few minutes and
 * nothing else.
 */

/** Ten minutes is long enough to start a slow upload, short enough to be dull. */
export const INGEST_TOKEN_TTL_MS = 10 * 60_000;

/** 24 GB. Above this the volume is the wrong place for it anyway. */
const MAX_BYTES = 24 * 1024 * 1024 * 1024;

export function signIngestToken(
  sourceId: string,
  secret: string,
  expiresAt: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${sourceId}.${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

function tokenIsValid(sourceId: string, token: string): boolean {
  const [expiryPart, signature] = token.split(".");
  const expiresAt = Number(expiryPart);

  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (Date.now() > expiresAt) return false;

  const expected = createHmac("sha256", config.sharedSecret)
    .update(`${sourceId}.${expiresAt}`)
    .digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Browsers preflight a cross-origin PUT, so the headers have to be present. */
export function applyCors(res: Response): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "PUT, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, x-ingest-token");
  res.setHeader("access-control-max-age", "86400");
}

async function probeDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

export async function handleIngest(req: Request, res: Response): Promise<void> {
  applyCors(res);

  const sourceId = String(req.params.id ?? "");
  const token = String(req.header("x-ingest-token") ?? req.query.token ?? "");

  if (!sourceId || !tokenIsValid(sourceId, token)) {
    res.status(401).json({ error: "Invalid or expired upload token." });
    return;
  }

  // The row must already exist and be waiting for bytes. This also stops a
  // valid-but-replayed token from overwriting a source that has moved on.
  const { data: source, error } = await db
    .from("source_videos")
    .select("id, owner_id, status")
    .eq("id", sourceId)
    .maybeSingle();

  if (error || !source) {
    res.status(404).json({ error: "No such source." });
    return;
  }
  if ((source as { status: string }).status !== "uploading") {
    res.status(409).json({
      error: `That source is already ${(source as { status: string }).status}.`,
    });
    return;
  }

  const relative = `sources/${sourceId}.mp4`;
  const destination = join(config.mediaDir, relative);
  await mkdir(dirname(destination), { recursive: true });

  let written = 0;
  req.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > MAX_BYTES) req.destroy(new Error("Upload exceeds the size limit."));
  });

  try {
    await pipeline(req, createWriteStream(destination));
  } catch (err) {
    // A browser tab closed mid-upload leaves a partial file; do not leave it on
    // the volume pretending to be a source.
    await rm(destination, { force: true }).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    log.warn("Ingest aborted", { sourceId, written, error: message });
    await db
      .from("source_videos")
      .update({ error_message: `Upload did not complete: ${message}` })
      .eq("id", sourceId);
    res.status(400).json({ error: message });
    return;
  }

  const { size } = await stat(destination);
  if (size === 0) {
    await rm(destination, { force: true }).catch(() => {});
    res.status(400).json({ error: "The upload was empty." });
    return;
  }

  // ffprobe is the real test that this is video the pipeline can open — a
  // truncated or mislabelled file fails here rather than three stages later.
  const durationSeconds = await probeDuration(destination);
  if (durationSeconds === null) {
    await rm(destination, { force: true }).catch(() => {});
    await db
      .from("source_videos")
      .update({
        status: "failed",
        error_message:
          "The uploaded file could not be read as video. It may have been " +
          "truncated, or it is a container ffmpeg does not recognise.",
      })
      .eq("id", sourceId);
    res.status(415).json({ error: "Not a readable video file." });
    return;
  }

  await db
    .from("source_videos")
    .update({
      status: "downloaded",
      storage_path: `${LOCAL_PREFIX}${relative}`,
      duration_seconds: durationSeconds,
      error_message: null,
      attempts: 0,
    })
    .eq("id", sourceId);

  log.info("Source ingested", {
    sourceId,
    megabytes: Math.round(size / 1048576),
    durationSeconds: Math.round(durationSeconds),
  });

  res.json({ ok: true, bytes: size, durationSeconds });
}
