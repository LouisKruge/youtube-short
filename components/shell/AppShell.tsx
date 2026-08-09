"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { ToastProvider } from "@/components/ui/Toast";
import type { QuotaSnapshot } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar, type Crumb } from "./TopBar";
import { WorkerBanner } from "./WorkerBanner";
import { ALL_NAV } from "./nav";

const COLLAPSE_KEY = "nexus.sidebar.collapsed";

export interface ShellProps {
  crumbs: Crumb[];
  quota: QuotaSnapshot;
  autoUpload: boolean;
  processing: number;
  email: string | null;
  /**
   * Fills the viewport and hands scrolling to the page — for the project
   * workspace, where the player and clip panel manage their own overflow.
   */
  bleed?: boolean;
  /**
   * Content measure. `wide` is for dense tables that genuinely use 1680px of
   * columns; everything else gets a narrower field, because stretching a list
   * and a paragraph across a 1600px monitor is not using the space, it is just
   * making the eye travel further for the same information.
   */
  width?: "default" | "wide";
  children: React.ReactNode;
}

/**
 * The application frame: sidebar, top bar, one scroll container.
 *
 * Keyboard travel is a first-class path, not an add-on. 1–7 jump between
 * sections, ⌘K opens the palette, / focuses search, [ collapses the sidebar.
 * Digits are ignored while a field has focus, so typing "10" into a number
 * input does not teleport the operator to Overview.
 */
export function AppShell({
  crumbs,
  quota,
  autoUpload,
  processing,
  email,
  bleed,
  width = "default",
  children,
}: ShellProps) {
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Read the stored preference after mount. Doing it in an effect rather than
  // during render keeps the server and first client paint identical.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Storage can be blocked; the default is fine.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Non-fatal — the session still works, it just will not persist.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        toggleCollapsed();
        return;
      }

      const item = ALL_NAV.find((nav) => nav.key === e.key);
      if (item) {
        e.preventDefault();
        router.push(item.href);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, toggleCollapsed]);

  return (
    <ToastProvider>
      {/* Bleed screens own the viewport and clip; ordinary screens scroll the
          page. Pinning the height here rather than inside `main` means anything
          that appears between the top bar and the content — the worker banner —
          takes its space out of the workspace instead of pushing it under the
          fold. */}
      <div
        className={cn(
          "flex w-full",
          bleed ? "h-screen overflow-hidden" : "min-h-screen",
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            bleed ? "min-h-0" : "min-h-screen",
          )}
        >
          <TopBar
            crumbs={crumbs}
            processing={processing}
            quota={quota}
            autoUpload={autoUpload}
            email={email}
            onOpenPalette={() => setPalette(true)}
          />

          {/* Above the content and outside the bleed container, so it appears
              on the workspace too rather than only on the scrolling screens. */}
          <WorkerBanner pending={processing} />

          <main
            className={cn(
              "min-w-0 flex-1",
              bleed
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "mx-auto w-full px-6 py-6",
              !bleed && (width === "wide" ? "max-w-work" : "max-w-[1240px]"),
            )}
          >
            {children}
          </main>
        </div>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </ToastProvider>
  );
}

/**
 * A screen's context row.
 *
 * There is deliberately no large heading here. The breadcrumb twelve pixels
 * above already names the screen, and the sidebar item is lit — a 22px title
 * would be the third statement of the same word and is the single most
 * recognisable tell of a generic dashboard. What remains is the one line worth
 * reading and the screen's primary action.
 *
 * `title` is still required: it becomes the document's h1 for screen readers and
 * for the tab, it is simply not set at display size.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex min-h-6 flex-wrap items-baseline justify-between gap-x-6 gap-y-2",
        className,
      )}
    >
      <h1 className="sr-only">{title}</h1>
      {description ? (
        <p className="min-w-0 max-w-prose text-base leading-relaxed text-fg-3">
          {description}
        </p>
      ) : (
        <span />
      )}
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
