import Link from "next/link";
import { QuotaMeter } from "@/components/QuotaMeter";
import type { QuotaSnapshot } from "@/lib/types";

const NAV = [
  { href: "/", label: "Ingest", key: "1" },
  { href: "/review", label: "Review", key: "2" },
  { href: "/library", label: "Library", key: "3" },
  { href: "/log", label: "Log", key: "4" },
  { href: "/settings", label: "Settings", key: "5" },
];

interface Props {
  active: string;
  quota: QuotaSnapshot;
  autoUpload: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Shell({
  active,
  quota,
  autoUpload,
  title,
  subtitle,
  children,
}: Props) {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-4 sm:px-8">
      <header className="flex flex-col gap-4 border-b border-rule py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="display text-xl">Nexus</span>
            <span className="eyebrow">clips</span>
          </Link>

          <nav className="flex gap-1" aria-label="Sections">
            {NAV.map((item) => {
              const isActive = item.href === active;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className="group relative rounded-[3px] px-3 py-1.5 text-sm transition-colors"
                  style={{
                    color: isActive ? "var(--text)" : "var(--dim)",
                    background: isActive ? "var(--panel)" : "transparent",
                  }}
                >
                  {item.label}
                  {isActive && (
                    <span
                      className="absolute inset-x-3 -bottom-[1px] block h-[2px]"
                      style={{ background: "var(--lamp)" }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <span
              className="block h-[6px] w-[6px] rounded-full"
              style={{ background: autoUpload ? "var(--live)" : "var(--dim)" }}
              aria-hidden="true"
            />
            <span
              className="eyebrow"
              style={{ color: autoUpload ? "var(--live)" : "var(--dim)" }}
            >
              auto-upload {autoUpload ? "on" : "off"}
            </span>
          </span>
          <QuotaMeter quota={quota} />
        </div>
      </header>

      <main className="flex-1 py-8">
        <div className="mb-8">
          <h1 className="display text-4xl sm:text-5xl">{title}</h1>
          {subtitle && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </main>

      <footer className="border-t border-rule py-4">
        <p className="eyebrow">
          Clips are selected by audio energy — loudness above a rolling
          baseline. That is a proxy for intensity, not for viewership.
        </p>
      </footer>
    </div>
  );
}
