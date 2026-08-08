import Link from "next/link";
import { missingCoreEnv, optionalEnvStatus } from "@/lib/config-check";

export const dynamic = "force-dynamic";

/**
 * Configuration triage.
 *
 * Reachable without a session by design — when Supabase is unconfigured
 * there is no way to sign in, and an unreachable diagnostics page is not a
 * diagnostics page. It reports only whether each variable is *set*, never its
 * value.
 */
export default function SetupPage() {
  const missing = missingCoreEnv();
  const optional = optionalEnvStatus();
  const ready = missing.length === 0;

  return (
    <div className="relative z-10 mx-auto min-h-screen w-full max-w-3xl px-4 py-16 sm:px-8">
      <div className="mb-10 flex items-baseline gap-2">
        <span className="display text-3xl">Nexus</span>
        <span className="eyebrow">clips</span>
      </div>

      <h1 className="display text-4xl sm:text-5xl">
        {ready ? "Configuration looks complete" : "Finish configuring this deployment"}
      </h1>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-dim">
        {ready
          ? "The required environment variables are all set. If you landed here from an error, redeploy so the new values are picked up."
          : "Nexus needs a Supabase project before it can render anything. Set the variables below in your host's environment settings, then redeploy."}
      </p>

      {!ready && (
        <section className="panel mt-8 p-6">
          <h2 className="eyebrow" style={{ color: "var(--peak)" }}>
            Required — missing
          </h2>
          <ul className="mt-4 space-y-4">
            {missing.map((v) => (
              <li key={v.name}>
                <code className="tc text-sm" style={{ color: "var(--peak)" }}>
                  {v.name}
                </code>
                <p className="mt-1 text-xs text-dim">{v.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-dim">
            On Vercel: <strong>Project Settings → Environment Variables</strong>.
            Adding a variable does not affect the running deployment — you must
            redeploy afterwards.
          </p>
        </section>
      )}

      <section className="panel mt-5 p-6">
        <h2 className="eyebrow">Feature credentials</h2>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          The app runs without these; the features that depend on them do not.
        </p>
        <ul className="mt-4 space-y-3">
          {optional.map((v) => (
            <li key={v.name} className="flex items-start gap-3">
              <span
                className="mt-[7px] block h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ background: v.configured ? "var(--live)" : "var(--dim)" }}
                aria-hidden="true"
              />
              <span>
                <code className="tc text-sm">{v.name}</code>
                <span className="block text-xs text-dim">{v.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel mt-5 p-6">
        <h2 className="eyebrow">Then</h2>
        <ol className="mt-4 space-y-3 text-sm text-dim">
          <li>
            <span className="tc mr-2" style={{ color: "var(--lamp)" }}>
              1
            </span>
            Apply <code className="tc">supabase/migrations/0001_init.sql</code> to
            your Supabase project.
          </li>
          <li>
            <span className="tc mr-2" style={{ color: "var(--lamp)" }}>
              2
            </span>
            Enable the Email provider in Supabase Auth — sign-in is a magic link.
          </li>
          <li>
            <span className="tc mr-2" style={{ color: "var(--lamp)" }}>
              3
            </span>
            Deploy the worker (see <code className="tc">worker/README.md</code>).
            Nothing is downloaded, cut, captioned or uploaded without it.
          </li>
        </ol>
      </section>

      {ready && (
        <Link
          href="/"
          className="mt-8 inline-block rounded-[3px] px-5 py-3 text-sm font-medium"
          style={{ background: "var(--lamp)", color: "var(--ink)" }}
        >
          Go to the dashboard
        </Link>
      )}
    </div>
  );
}
