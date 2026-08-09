import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SettingsForm } from "@/components/SettingsForm";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Note, Status, type Tone } from "@/components/ui/Status";
import { Kbd } from "@/components/ui/Tooltip";
import { pageContext } from "@/lib/page-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { workerHealth } from "@/lib/worker";

export const dynamic = "force-dynamic";

interface Credential {
  name: string;
  tone: Tone;
  state: string;
  detail: string;
}

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["⌘", "K"], label: "Command palette and search" },
  { keys: ["/"], label: "Search" },
  { keys: ["1", "–", "7"], label: "Jump to a section" },
  { keys: ["["], label: "Collapse the sidebar" },
  { keys: ["J", "K"], label: "Walk the queue" },
  { keys: ["Space"], label: "Play or pause the monitor" },
  { keys: [",", "."], label: "Step one frame" },
];

export default async function SettingsPage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const db = createAdminClient();

  const [{ data: channel }, { count: queuedCount }, worker] = await Promise.all([
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
    workerHealth(),
  ]);

  // Secrets live in environment variables, never in the database — so this page
  // reports whether each one is configured, not what it is.
  const credentials: Credential[] = [
    {
      name: "Anthropic API key",
      tone: process.env.ANTHROPIC_API_KEY ? "done" : "attention",
      state: process.env.ANTHROPIC_API_KEY ? "configured" : "missing",
      detail: "Scores candidate moments and writes hooks and metadata",
    },
    {
      name: "OpenAI API key",
      tone: process.env.OPENAI_API_KEY ? "done" : "attention",
      state: process.env.OPENAI_API_KEY ? "configured" : "missing",
      detail: "Whisper transcription, word-level, on the worker",
    },
    {
      name: "Google OAuth client",
      tone:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? "done"
          : "attention",
      state:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? "configured"
          : "missing",
      detail: "YouTube Data API v3 uploads",
    },
    {
      name: "Worker service",
      tone: worker ? "done" : "attention",
      state: worker ? "reachable" : "unreachable",
      detail: worker
        ? "ffmpeg, yt-dlp and Whisper run here"
        : "Nothing will download, cut or render until this is up",
    },
  ];

  return (
    <AppShell
      crumbs={[{ label: "Settings" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
    >
      <PageHeader
        title="Settings"
        description="The upload gate, pipeline defaults, and what this deployment is running on."
      />

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <SettingsForm settings={settings} queuedCount={queuedCount ?? 0} />

        <div className="space-y-5">
          {/* Channel ----------------------------------------------------- */}
          <Panel>
            <PanelHeader
              title="YouTube channel"
              actions={
                <Status
                  tone={channel?.channel_id ? "done" : "idle"}
                  label={channel?.channel_id ? "connected" : "not connected"}
                />
              }
            />
            <PanelSection>
              {channel?.channel_id ? (
                <>
                  <p className="text-base text-fg">{channel.channel_title}</p>
                  <p className="t-num mt-1 text-xs text-fg-4">{channel.channel_id}</p>
                  <form action="/api/auth/youtube/disconnect" method="post" className="mt-3">
                    <button
                      type="submit"
                      className="h-6 rounded px-2 text-xs text-fg-3 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg"
                    >
                      Disconnect channel
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="max-w-prose text-base leading-relaxed text-fg-2">
                    Nexus needs permission to upload to one channel. You will be
                    sent to Google to authorize it.
                  </p>
                  <a
                    href="/api/auth/youtube/start"
                    className="mt-3 inline-flex h-7 items-center rounded border border-fg bg-fg px-3 text-sm font-medium text-bg transition-colors duration-fast ease-ease hover:bg-white"
                  >
                    Connect channel
                  </a>
                </>
              )}
            </PanelSection>
          </Panel>

          {/* Credentials ------------------------------------------------- */}
          <Panel>
            <PanelHeader title="Credentials" />
            <PanelSection>
              <ul className="divide-y divide-line">
                {credentials.map((credential) => (
                  <li
                    key={credential.name}
                    className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{credential.name}</span>
                      <span className="mt-0.5 block max-w-prose text-xs leading-relaxed text-fg-3">
                        {credential.detail}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5">
                      <Status tone={credential.tone} label={credential.state} />
                    </span>
                  </li>
                ))}
              </ul>
              <Note className="mt-3">
                Keys are read from environment variables and never stored in the
                database. Change them where you deploy.
              </Note>
            </PanelSection>
          </Panel>

          {/* Keyboard --------------------------------------------------- */}
          <Panel>
            <PanelHeader title="Keyboard" />
            <PanelSection>
              <ul className="divide-y divide-line">
                {SHORTCUTS.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="text-sm text-fg-2">{shortcut.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key, i) =>
                        key === "–" ? (
                          <span key={i} className="text-xs text-fg-4">
                            –
                          </span>
                        ) : (
                          <Kbd key={i}>{key}</Kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelSection>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
