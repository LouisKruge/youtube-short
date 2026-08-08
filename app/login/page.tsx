"use client";

import { useState } from "react";
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
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-baseline gap-2">
          <span className="display text-3xl">Nexus</span>
          <span className="eyebrow">clips</span>
        </div>

        {sent ? (
          <div className="panel p-6">
            <h1 className="display text-2xl">Check your inbox</h1>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              We sent a sign-in link to {email}. Open it on this device to
              continue.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="panel p-6">
            <h1 className="display text-2xl">Sign in</h1>
            <p className="mt-2 text-sm leading-relaxed text-dim">
              Nexus Clips is a single-operator dashboard. Sign in with the email
              that owns this deployment.
            </p>

            <label htmlFor="email" className="eyebrow mt-6 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="panel-inset mt-2 w-full px-4 py-3 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            />

            <button
              type="submit"
              disabled={busy}
              className="mt-4 w-full rounded-[3px] px-4 py-3 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--lamp)", color: "var(--ink)" }}
            >
              {busy ? "Sending…" : "Send sign-in link"}
            </button>

            {error && (
              <p className="mt-3 text-sm" style={{ color: "var(--peak)" }} role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
