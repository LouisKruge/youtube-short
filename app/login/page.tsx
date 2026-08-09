"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Alert, Note, Status } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";
import { AuthFrame } from "@/components/shell/Wordmark";
import { createClient } from "@/lib/supabase/client";

type Method = "password" | "link";

/** Remembers which method worked last, so the usual path is the default one. */
const METHOD_KEY = "nexus.auth.method";

function LoginForm() {
  const params = useSearchParams();
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(METHOD_KEY);
      if (stored === "link" || stored === "password") setMethod(stored);
    } catch {
      // Storage can be blocked; the default is fine.
    }
  }, []);

  // The callback route sends people back here when a link has already been
  // used or has aged out.
  useEffect(() => {
    if (params.get("error") === "link_expired") {
      setError("That sign-in link has expired or was already used.");
    }
  }, [params]);

  function remember(next: Method) {
    setMethod(next);
    setError(null);
    try {
      window.localStorage.setItem(METHOD_KEY, next);
    } catch {
      // Non-fatal.
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setBusy(false);
    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "That email and password do not match. If you have only ever used a sign-in link, you do not have a password yet — use a link, then set one in Settings."
          : signInError.message,
      );
      return;
    }

    remember("password");
    // A full navigation rather than router.push: the session cookie has just
    // been written, and the server needs to see it on the next request.
    window.location.assign(params.get("next") ?? "/");
  }

  async function sendLink(e: React.FormEvent) {
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
    else {
      remember("link");
      setSent(true);
    }
  }

  if (sent) {
    return (
      <Panel>
        <PanelHeader title="Link sent" actions={<Status tone="done" label="sent" />} />
        <PanelSection>
          <p className="max-w-prose text-base leading-relaxed text-fg-2">
            A sign-in link is on its way to <span className="text-fg">{email}</span>.
            Open it on this device — the link carries the session, so it has to
            land in this browser.
          </p>
          <Note className="mt-3">
            Tired of this? Once you are in, set a password in Settings and you
            will not need a link again.
          </Note>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-4 h-6 rounded px-2 text-xs text-fg-3 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg"
          >
            Use a different address
          </button>
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Sign in" />

      <Tabs
        items={[
          { value: "password", label: "Password" },
          { value: "link", label: "Email link" },
        ]}
        value={method}
        onChange={(next) => remember(next as Method)}
        className="px-3"
      />

      <form onSubmit={method === "password" ? signInWithPassword : sendLink}>
        <PanelSection>
          <Field label="Email" htmlFor="email">
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

          {method === "password" && (
            <Field
              label="Password"
              htmlFor="password"
              className="mt-3"
              hint="Stays signed in on this browser until you sign out."
            >
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9"
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            disabled={busy || email.trim().length === 0}
            className="mt-4"
          >
            {busy
              ? method === "password"
                ? "Signing in…"
                : "Sending…"
              : method === "password"
                ? "Sign in"
                : "Send sign-in link"}
          </Button>

          {error && <Alert className="mt-3">{error}</Alert>}

          {method === "password" && (
            <Note className="mt-3">
              No password yet? Sign in with a link once, then set one in
              Settings.
            </Note>
          )}
        </PanelSection>
      </form>
    </Panel>
  );
}

export default function LoginPage() {
  return (
    <AuthFrame
      footer={
        <Note>
          Nexus Clips is a single-operator workstation. There is no sign-up — the
          deployment belongs to whoever holds its environment variables.
        </Note>
      }
    >
      {/* useSearchParams needs a boundary for the static shell to prerender. */}
      <Suspense fallback={<Panel className="h-[280px]" />}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
