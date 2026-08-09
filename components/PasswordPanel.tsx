"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Alert, Note, Status } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";

/** Supabase's own floor is 6; 10 is a more honest minimum for a live channel. */
const MIN_LENGTH = 10;

/**
 * Set or change the sign-in password.
 *
 * This exists so the operator can stop using email links. A magic link is a new
 * email on every sign-in by design — that is the whole mechanism — so the only
 * way to not receive one is to have a credential that does not need sending.
 *
 * `updateUser` runs against the caller's own session with the anon key, so this
 * never touches the service-role client and cannot change anyone else's account.
 */
export function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two entries do not match.");
      return;
    }

    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({
      password,
    });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPassword("");
    setConfirm("");
    setDone(true);
    toast("Password set");
  }

  return (
    <Panel>
      <PanelHeader
        title="Password"
        actions={
          <Status
            tone={hasPassword || done ? "done" : "idle"}
            label={hasPassword || done ? "set" : "not set"}
          />
        }
      />
      <PanelSection>
        <p className="max-w-prose text-base leading-relaxed text-fg-2">
          {hasPassword || done
            ? "You can sign in with email and password — no link, no inbox round trip. Setting a new one here replaces the old one immediately."
            : "Set a password and you will not need an email link again. The link stays available as a way back in if you forget it."}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field
            label={hasPassword || done ? "New password" : "Password"}
            htmlFor="new-password"
            hint={`At least ${MIN_LENGTH} characters.`}
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 max-w-[320px]"
            />
          </Field>

          <Field label="Confirm" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-9 max-w-[320px]"
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            disabled={busy || password.length === 0}
          >
            {busy ? "Saving…" : hasPassword || done ? "Replace password" : "Set password"}
          </Button>

          {error && <Alert>{error}</Alert>}
        </form>

        <Note className="mt-4">
          Signing in with a password keeps you signed in on this browser until
          you sign out — the session refreshes itself in the background.
        </Note>
      </PanelSection>
    </Panel>
  );
}
