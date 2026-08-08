/**
 * Boot-time configuration checks.
 *
 * Next.js inlines `process.env.X` at build time, and only for statically
 * written references — `process.env[name]` with a computed key silently
 * yields undefined in the Edge runtime. Every variable below is therefore
 * spelled out literally rather than looped over.
 */

export interface RequiredVar {
  name: string;
  detail: string;
}

/**
 * The app cannot render a single page without these: middleware, every page,
 * and every route handler need a Supabase client.
 */
export function missingCoreEnv(): RequiredVar[] {
  const missing: RequiredVar[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push({
      name: "NEXT_PUBLIC_SUPABASE_URL",
      detail: "Supabase project URL — Project Settings → API",
    });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push({
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      detail: "Supabase anon/publishable key — safe to expose to the browser",
    });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push({
      name: "SUPABASE_SERVICE_ROLE_KEY",
      detail: "Supabase service role key — server only, never sent to the browser",
    });
  }

  return missing;
}

/**
 * Middleware runs on the Edge runtime and only needs the two public values to
 * build its session client. Kept separate so a missing server-only key does
 * not take down every route before the setup page can explain why.
 */
export function middlewareCanRun(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Feature-level credentials. Absent means degraded, not broken. */
export function optionalEnvStatus(): Array<RequiredVar & { configured: boolean }> {
  return [
    {
      name: "ANTHROPIC_API_KEY",
      detail: "Writes the description hooks",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    {
      name: "OPENAI_API_KEY",
      detail: "Whisper transcription (used by the worker)",
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      name: "GOOGLE_CLIENT_ID",
      detail: "YouTube OAuth client",
      configured: Boolean(process.env.GOOGLE_CLIENT_ID),
    },
    {
      name: "GOOGLE_CLIENT_SECRET",
      detail: "YouTube OAuth client secret",
      configured: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    },
    {
      name: "GOOGLE_REDIRECT_URI",
      detail: "Must exactly match the URI registered in Google Cloud",
      configured: Boolean(process.env.GOOGLE_REDIRECT_URI),
    },
    {
      name: "WORKER_URL",
      detail: "The ffmpeg/yt-dlp/upload service — nothing processes without it",
      configured: Boolean(process.env.WORKER_URL),
    },
    {
      name: "WORKER_SHARED_SECRET",
      detail: "Must match the same value on the worker",
      configured: Boolean(process.env.WORKER_SHARED_SECRET),
    },
  ];
}
