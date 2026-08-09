"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { CellMeter } from "@/components/ui/Meter";
import { Kbd } from "@/components/ui/Tooltip";
import type { QuotaSnapshot } from "@/lib/types";
import { ProfileMenu } from "./ProfileMenu";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The top bar carries location on the left and machine state on the right, and
 * nothing else. 48px, sticky, one hairline underneath.
 *
 * Everything on the right is a live reading: how many jobs are in flight, how
 * many uploads remain against today's quota. Those two numbers decide whether
 * there is any point starting something, so they are visible from every screen.
 */
export function TopBar({
  crumbs,
  processing,
  quota,
  autoUpload,
  email,
  onOpenPalette,
}: {
  crumbs: Crumb[];
  processing: number;
  quota: QuotaSnapshot;
  autoUpload: boolean;
  email: string | null;
  onOpenPalette: () => void;
}) {
  const spent = quota.uploadsPerDay - quota.uploadsRemaining;

  return (
    <header className="sticky top-0 z-20 flex h-topbar items-center gap-4 border-b border-line bg-raised/95 px-4 backdrop-blur-[2px]">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  size={12}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-fg-4"
                />
              )}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="truncate text-sm text-fg-3 transition-colors duration-fast ease-ease hover:text-fg-2"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "truncate text-sm",
                    last ? "text-fg" : "text-fg-3",
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Jobs in flight. Absent entirely when nothing is running — a zero
            here would be a permanent reminder of nothing happening. */}
        {processing > 0 && (
          <Link
            href="/radar"
            className="flex h-7 items-center gap-2 rounded px-2.5 transition-colors duration-fast ease-ease hover:bg-s2"
            title={`${processing} job${processing === 1 ? "" : "s"} in flight — open Radar`}
          >
            <span
              aria-hidden="true"
              className="anim-pulse block h-[5px] w-[5px] rounded-full bg-fg-2"
            />
            <span className="t-label text-fg-2">processing</span>
            <span className="t-num text-xs text-fg">
              {String(processing).padStart(2, "0")}
            </span>
          </Link>
        )}

        <span className="mx-1 block h-4 w-px bg-line" aria-hidden="true" />

        {/* Quota. The cells make "two left" readable without parsing digits. */}
        <Link
          href="/analytics"
          className="flex h-7 items-center gap-2.5 rounded px-2.5 transition-colors duration-fast ease-ease hover:bg-s2"
          title={`${quota.uploadsRemaining} of ${quota.uploadsPerDay} uploads left today (${quota.unitsUsed.toLocaleString()} of ${quota.limit.toLocaleString()} units, Pacific day ${quota.date})`}
        >
          <CellMeter
            total={quota.uploadsPerDay}
            filled={spent}
            label={`${quota.uploadsRemaining} uploads remaining today`}
          />
          <span className="t-num text-xs text-fg-2">
            <span className={quota.uploadsRemaining === 0 ? "text-fg" : "text-fg"}>
              {quota.uploadsRemaining}
            </span>
            <span className="text-fg-4">/{quota.uploadsPerDay}</span>
          </span>
        </Link>

        <span className="mx-1 block h-4 w-px bg-line" aria-hidden="true" />

        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-7 items-center gap-2 rounded border border-line bg-s2 pl-2 pr-1.5 text-fg-3 transition-colors duration-fast ease-ease hover:border-line-strong hover:text-fg-2"
          aria-label="Search and commands"
        >
          <Search size={12} strokeWidth={1.5} />
          <span className="hidden text-xs lg:inline">Search</span>
          <Kbd>⌘K</Kbd>
        </button>

        <ProfileMenu email={email} autoUpload={autoUpload} />
      </div>
    </header>
  );
}
