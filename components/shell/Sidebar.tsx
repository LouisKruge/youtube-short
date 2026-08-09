"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { PRIMARY_NAV, SECONDARY_NAV, isCurrent, type NavItem } from "./nav";
import { Mark } from "./Wordmark";
import { WORKER_COPY, useWorkerState } from "./useWorkerState";

/**
 * The sidebar.
 *
 * Fixed 216px, its own vertical rule, and nothing in it competes for attention.
 * The current item is marked by a 1px bar on the left edge plus a brightness
 * step — no filled pill, because an active pill in a monochrome interface reads
 * as heavier than the content it is pointing at.
 *
 * Collapsed, it drops to 48px and keeps the icons: on a 1280 laptop the
 * project workspace needs the width more than the labels.
 */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const { state: worker, reason } = useWorkerState();

  return (
    <aside
      className={cn(
        "sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-line bg-bg transition-[width] duration-slow ease-ease",
        collapsed ? "w-[48px]" : "w-sidebar",
      )}
    >
      {/* Wordmark. Two lines, stacked and tracked out — a plate marking. */}
      <div
        className={cn(
          "flex h-topbar items-center rule-b",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <Link
          href="/"
          className="group flex items-center gap-2"
          aria-label="Nexus Clips — Overview"
        >
          <Mark />
          {!collapsed && (
            <span className="leading-[1.05]">
              <span className="block text-[11px] font-medium tracking-[0.16em] text-fg">
                NEXUS
              </span>
              <span className="block text-[11px] tracking-[0.16em] text-fg-3">
                CLIPS
              </span>
            </span>
          )}
        </Link>
      </div>

      <nav
        className={cn("flex flex-1 flex-col gap-px py-2", collapsed ? "px-1.5" : "px-2")}
        aria-label="Sections"
      >
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            current={isCurrent(item, pathname)}
            collapsed={collapsed}
          />
        ))}

        <span className={cn("my-2 h-px bg-line", collapsed ? "mx-1" : "mx-2")} />

        {SECONDARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            current={isCurrent(item, pathname)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* One footer bar, not two stacked 32px strips. Worker reachability on
          the left because it changes what the operator can do; the collapse
          control hard right, where a window control belongs. */}
      <div className={cn("flex h-8 items-center rule-t", collapsed ? "flex-col justify-center px-0" : "gap-2 px-3")}>
        <span
          className="flex min-w-0 items-center gap-2"
          title={reason ?? WORKER_COPY[worker].title}
        >
          <span
            aria-hidden="true"
            className={cn(
              "block h-[5px] w-[5px] shrink-0",
              worker === "online" && "rounded-full bg-fg-2",
              worker === "unknown" && "anim-pulse rounded-full bg-fg-4",
              worker === "offline" && "bg-fg",
              worker === "unconfigured" && "rounded-full border border-fg-4",
            )}
          />
          {!collapsed && (
            <span
              className={cn("t-label truncate", worker === "offline" && "text-fg")}
            >
              {WORKER_COPY[worker].label}
            </span>
          )}
        </span>

        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar  ["
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-4 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg-2"
          >
            <PanelLeft size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex h-8 items-center justify-center rule-t">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar  ["
            className="flex h-6 w-6 items-center justify-center rounded text-fg-4 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg-2"
          >
            <PanelLeft size={13} strokeWidth={1.5} />
          </button>
        </div>
      )}

    </aside>
  );
}

function NavLink({
  item,
  current,
  collapsed,
}: {
  item: NavItem;
  current: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-7 items-center rounded transition-colors duration-fast ease-ease",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2",
        current ? "bg-s2 text-fg" : "text-fg-3 hover:bg-s2 hover:text-fg-2",
      )}
    >
      {/* Edge bar: the entire active treatment, 1px wide. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 block h-[14px] w-px -translate-y-1/2 transition-colors duration-fast",
          current ? "bg-fg" : "bg-transparent",
        )}
      />
      <Icon size={14} strokeWidth={1.5} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate text-sm">{item.label}</span>
          <span
            className={cn(
              "t-num ml-auto text-2xs transition-opacity duration-fast",
              current ? "text-fg-4" : "text-transparent group-hover:text-fg-4",
            )}
          >
            {item.key}
          </span>
        </>
      )}
    </Link>
  );
}
