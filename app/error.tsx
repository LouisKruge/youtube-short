"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Note, Status } from "@/components/ui/Status";
import { Wordmark } from "@/components/shell/Wordmark";

/**
 * The error boundary.
 *
 * Says what broke, offers the two things that actually help — retry, or go
 * somewhere that works — and shows the digest, because that is the string that
 * finds the trace in the host's logs. No apology copy, no illustration.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server-side trace is already captured; this puts the same failure in
    // the browser console for anyone debugging with devtools open.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] px-6 py-16">
      <Wordmark className="mb-10" />

      <Panel>
        <PanelHeader
          title="Something failed"
          actions={<Status tone="attention" label="error" />}
        />
        <PanelSection>
          <p className="max-w-prose text-base leading-relaxed text-fg-2">
            This screen could not render. It is usually a query that timed out or
            a missing environment variable rather than anything you did.
          </p>

          <p className="mt-3 border-l-2 border-fg bg-s2 py-2 pl-3 text-xs leading-relaxed text-fg">
            {error.message || "No message was attached to the error."}
          </p>

          {error.digest && (
            <p className="t-num mt-2 text-2xs text-fg-4">digest {error.digest}</p>
          )}

          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href="/" variant="secondary">
              Overview
            </ButtonLink>
            <ButtonLink href="/setup" variant="ghost">
              Check configuration
            </ButtonLink>
          </div>

          <Note className="mt-5">
            If this repeats on every screen, the deployment is probably missing a
            Supabase or service-role variable — the configuration page names which.
          </Note>
        </PanelSection>
      </Panel>
    </div>
  );
}
