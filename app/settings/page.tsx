import { QuotaMeter } from "@/components/QuotaMeter";
import { SettingsForm } from "@/components/SettingsForm";
import { Shell } from "@/components/Shell";
import { pageContext } from "@/lib/page-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { workerHealth } from "@/lib/worker";

export const dynamic = "force-dynamic";

interface Credential {
  name: string;
  configured: boolean;
  detail: string;
}

export default async function SettingsPage() {
  const { ownerId, settings, quota } = await pageContext();
  const db = createAdminClient();

  const [{ data: channel }, { count: queuedCount }, { data: history }, worker] =
    await Promise.all([
      db
        .from("youtube_accounts")
        .select("channel_title, channel_id, connected_at")
        .eq("owner_id", ownerId)
        .maybeSingle(),
      db
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("status", "queued"),
      db
        .from("quota_usage")
        .select("usage_date, units_used")
        .eq("owner_id", ownerId)
        .order("usage_date", { ascending: false })
        .limit(14),
      workerHealth(),
    ]);

  // Secrets live in environment variables, never in the database — so this
  // page reports whether each one is configured, not what it is.
  const credentials: Credential[] = [
    {
      name: "Anthropic API key",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      detail: "Writes the description hooks",
    },
    {
      name: "OpenAI API key",
      configured: Boolean(process.env.OPENAI_API_KEY),
      detail: "Whisper transcription on the worker",
    },
    {
      name: "Google OAuth client",
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
      detail: "YouTube Data API v3 uploads",
    },
    {
      name: "Worker service",
      configured: worker,
      detail: worker
        ? "Reachable — ffmpeg, yt-dlp and Whisper run here"
        : "Unreachable. Download and rendering will not run until this is up.",
    },
  ];

  return (
    <Shell
      active="/settings"
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      title="Settings"
      subtitle="The upload gate, pipeline defaults, and the credentials this deployment is running on."
    >
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <SettingsForm settings={settings} queuedCount={queuedCount ?? 0} />

        <div className="space-y-5">
          {/* YouTube channel */}
          <section className="panel p-6">
            <h2 className="display text-2xl">YouTube channel</h2>
            {channel?.channel_id ? (
              <>
                <p className="mt-4 text-sm">{channel.channel_title}</p>
                <p className="tc mt-1 text-xs text-dim">{channel.channel_id}</p>
                <form action="/api/auth/youtube/disconnect" method="post" className="mt-4">
                  <button
                    type="submit"
                    className="text-xs text-dim underline underline-offset-4 hover:text-[color:var(--peak)]"
                  >
                    Disconnect channel
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm leading-relaxed text-dim">
                  Nexus needs permission to upload to one channel. You will be
                  sent to Google to authorize it.
                </p>
                <a
                  href="/api/auth/youtube/start"
                  className="mt-4 inline-block rounded-[3px] px-4 py-2.5 text-sm font-medium"
                  style={{ background: "var(--lamp)", color: "var(--ink)" }}
                >
                  Connect channel
                </a>
              </>
            )}
          </section>

          {/* Quota */}
          <section className="panel p-6">
            <h2 className="display text-2xl">Quota</h2>
            <div className="mt-4">
              <QuotaMeter quota={quota} detailed />
            </div>

            {history && history.length > 0 && (
              <div className="mt-5">
                <p className="eyebrow mb-2">Last 14 days</p>
                <div className="flex items-end gap-[3px]" style={{ height: 44 }}>
                  {[...history].reverse().map((day) => {
                    const pct = Math.min(
                      1,
                      (day.units_used as number) / quota.limit,
                    );
                    return (
                      <div
                        key={day.usage_date as string}
                        title={`${day.usage_date}: ${(day.units_used as number).toLocaleString()} units`}
                        className="flex-1 rounded-t-[1px]"
                        style={{
                          height: `${Math.max(4, pct * 100)}%`,
                          background:
                            pct >= 1 ? "var(--peak)" : "var(--lamp)",
                          opacity: 0.85,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <p className="mt-5 text-xs leading-relaxed text-dim">
              Need more than {quota.uploadsPerDay} uploads a day? Google grants
              increases through a manual application in the Cloud Console —
              Nexus cannot request one for you, and it takes weeks.
            </p>
          </section>

          {/* Credentials */}
          <section className="panel p-6">
            <h2 className="display text-2xl">Credentials</h2>
            <p className="mt-2 text-xs leading-relaxed text-dim">
              Keys are read from environment variables and never stored in the
              database. Change them where you deploy.
            </p>
            <ul className="mt-4 space-y-3">
              {credentials.map((cred) => (
                <li key={cred.name} className="flex items-start gap-3">
                  <span
                    className="mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{
                      background: cred.configured
                        ? "var(--live)"
                        : "var(--peak)",
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block text-sm">{cred.name}</span>
                    <span className="block text-xs text-dim">{cred.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Shell>
  );
}
