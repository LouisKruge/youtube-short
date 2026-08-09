import { ButtonLink } from "@/components/ui/Button";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Note, Status } from "@/components/ui/Status";
import { Wordmark } from "@/components/shell/Wordmark";
import { missingCoreEnv, optionalEnvStatus } from "@/lib/config-check";

export const dynamic = "force-dynamic";

const STEPS: Array<{ text: React.ReactNode }> = [
  {
    text: (
      <>
        Apply <Code>supabase/migrations/0001_init.sql</Code> to your Supabase
        project, then <Code>0002</Code> and <Code>0003</Code>.
      </>
    ),
  },
  {
    text: <>Enable the Email provider in Supabase Auth — sign-in is a magic link.</>,
  },
  {
    text: (
      <>
        Deploy the worker (see <Code>worker/README.md</Code>). Nothing is
        downloaded, cut, captioned or uploaded without it — this is not optional.
      </>
    ),
  },
];

/**
 * Configuration triage.
 *
 * Reachable without a session by design — when Supabase is unconfigured there is
 * no way to sign in, and an unreachable diagnostics page is not a diagnostics
 * page. It reports only whether each variable is *set*, never its value.
 */
export default function SetupPage() {
  const missing = missingCoreEnv();
  const optional = optionalEnvStatus();
  const ready = missing.length === 0;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[680px] px-6 py-16">
      <Wordmark className="mb-10" />

      <h1 className="t-hero">
        {ready ? "Configuration looks complete" : "Finish configuring this deployment"}
      </h1>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-fg-3">
        {ready
          ? "The required environment variables are all set. If you landed here from an error, redeploy so the new values are picked up."
          : "Nexus needs a Supabase project before it can render anything. Set the variables below where you deploy, then redeploy."}
      </p>

      <div className="mt-8 space-y-5">
        {!ready && (
          <Panel>
            <PanelHeader
              title="Required"
              count={missing.length}
              actions={<Status tone="attention" label="missing" />}
            />
            <PanelSection>
              <ul className="divide-y divide-line">
                {missing.map((variable) => (
                  <li key={variable.name} className="py-2.5 first:pt-0 last:pb-0">
                    <Code strong>{variable.name}</Code>
                    <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-3">
                      {variable.detail}
                    </p>
                  </li>
                ))}
              </ul>
              <Note className="mt-3">
                On Vercel these live in Project Settings → Environment Variables.
                Adding one does not affect the running deployment; you have to
                redeploy afterwards.
              </Note>
            </PanelSection>
          </Panel>
        )}

        <Panel>
          <PanelHeader title="Feature credentials" />
          <PanelSection>
            <p className="mb-3 max-w-prose text-xs leading-relaxed text-fg-3">
              The app runs without these. The features that depend on them do not.
            </p>
            <ul className="divide-y divide-line">
              {optional.map((variable) => (
                <li
                  key={variable.name}
                  className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <Code>{variable.name}</Code>
                    <span className="mt-0.5 block max-w-prose text-xs leading-relaxed text-fg-3">
                      {variable.detail}
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5">
                    <Status
                      tone={variable.configured ? "done" : "idle"}
                      label={variable.configured ? "set" : "not set"}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>

        <Panel>
          <PanelHeader title="Then" />
          <PanelSection>
            <ol className="divide-y divide-line">
              {STEPS.map((step, i) => (
                <li key={i} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="t-num shrink-0 text-xs text-fg-4">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="max-w-prose text-sm leading-relaxed text-fg-2">
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
          </PanelSection>
        </Panel>
      </div>

      {ready && (
        <ButtonLink href="/" variant="primary" size="lg" className="mt-8">
          Open the workstation
        </ButtonLink>
      )}
    </div>
  );
}

/** Inline code, set in the figure font so paths align with the rest of the UI. */
function Code({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <code
      className={
        strong ? "t-num text-sm text-fg" : "t-num text-sm text-fg-2"
      }
    >
      {children}
    </code>
  );
}
