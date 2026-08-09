import {
  BarChart3,
  Gauge,
  Layers,
  Radar,
  Rows3,
  SlidersHorizontal,
  Clapperboard,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Number key that jumps here. Mirrors the sidebar order. */
  key: string;
  /** Also treat these path prefixes as this item being current. */
  match?: string[];
}

/**
 * Navigation, in workflow order: what's happening, what you're working on,
 * what you've made, what's being watched, what's waiting to go out. Analytics
 * and Settings are a separate group because they are not part of the loop.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: Gauge, key: "1" },
  { href: "/projects", label: "Projects", icon: Clapperboard, key: "2", match: ["/projects"] },
  { href: "/library", label: "Library", icon: Layers, key: "3" },
  { href: "/radar", label: "Radar", icon: Radar, key: "4" },
  { href: "/queue", label: "Queue", icon: Rows3, key: "5" },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/analytics", label: "Analytics", icon: BarChart3, key: "6" },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal, key: "7" },
];

export const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Longest-prefix match, so /projects/abc marks Projects current, not Overview. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  if (pathname === item.href) return true;
  return (item.match ?? []).some((prefix) => pathname.startsWith(`${prefix}/`));
}
