function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  sharedSecret: required("WORKER_SHARED_SECRET"),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  mediaBucket: process.env.MEDIA_BUCKET ?? "nexus-media",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  mediaDir: process.env.MEDIA_DIR ?? "/tmp/nexus-media",

  /** How often the worker polls for work on its own, independent of nudges. */
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),

  /** Give up on a job after this many attempts and mark it failed. */
  maxAttempts: Number(process.env.MAX_ATTEMPTS ?? 3),

  /** A claim older than this is treated as a crashed worker and reclaimed. */
  claimTimeoutMs: Number(process.env.CLAIM_TIMEOUT_MS ?? 30 * 60_000),

  /** Seconds between loudness samples in the analysis envelope. */
  analysisHopSeconds: Number(process.env.ANALYSIS_HOP_SECONDS ?? 0.5),

  /**
   * Render both caption styles up front instead of on selection.
   *
   * OFF (default): one render per clip, but the operator waits ~20s after
   * picking a style. ON: no wait at selection, but every clip is encoded
   * twice — roughly double the CPU and storage, and half of it is thrown
   * away for clips that are never approved.
   */
  renderBothCaptionStyles:
    (process.env.RENDER_BOTH_CAPTION_STYLES ?? "false").toLowerCase() === "true",

  /** Skip transcription entirely (captions become unavailable). */
  transcriptionEnabled:
    (process.env.TRANSCRIPTION_ENABLED ?? "true").toLowerCase() === "true",
};

export type Config = typeof config;
