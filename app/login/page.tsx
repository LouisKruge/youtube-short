"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Alert, Note, Status } from "@/components/ui/Status";
import { AuthFrame } from "@/components/shell/Wordmark";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setBusy(false);
    if (signInError) setError(signInError.message);
    else setSent(true);
  }

  return (
    <AuthFrame
      footer={
        <Note>
          Nexus Clips is a single-operator workstation. There is no sign-up — the
          deployment belongs to whoever holds its environment variables.
        </Note>
      }
    >
      {sent ? (
        <Panel>
          <PanelHeader
            title="Link sent"
            actions={<Status tone="done" label="sent" />}
          />
          <PanelSection>
            <p className="max-w-prose text-base leading-relaxed text-fg-2">
              A sign-in link is on its way to{" "}
              <span className="text-fg">{email}</span>. Open it on this device —
              the link carries the session, so it has to land in this browser.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-4 h-6 rounded px-2 text-xs text-fg-3 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg"
            >
              Use a different address
            </button>
          </PanelSection>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title="Sign in" />
          <form onSubmit={submit}>
            <PanelSection>
              <Field
                label="Email"
                htmlFor="email"
                hint="You will get a one-time link. No password to keep."
              >
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9"
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                disabled={busy || email.trim().length === 0}
                className="mt-4"
              >
                {busy ? "Sending…" : "Send sign-in link"}
              </Button>

              {error && <Alert className="mt-3">{error}</Alert>}
            </PanelSection>
          </form>
        </Panel>
      )}
    </AuthFrame>
  );
}
