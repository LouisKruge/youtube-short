"use client";

import { cn } from "./cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Rendered as a dim figure beside the label. Omit rather than pass 0. */
  count?: number;
}

/**
 * Tab bar. The active tab is marked by a 1px rule sitting on the divider and a
 * brightness step in the label — no pill, no plate, no fill. At a glance the
 * whole bar still reads as one horizontal line, which is what keeps it from
 * competing with the content underneath.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-stretch gap-0 rule-b", className)} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative -mb-px flex h-7 items-center gap-2 border-b px-3 transition-colors duration-fast ease-ease",
              active
                ? "border-fg text-fg"
                : "border-transparent text-fg-3 hover:text-fg-2",
            )}
          >
            <span className="t-label" style={{ color: "inherit" }}>
              {item.label}
            </span>
            {item.count !== undefined && (
              <span
                className={cn("t-num text-2xs", active ? "text-fg-2" : "text-fg-4")}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A two-to-five position selector for mutually exclusive settings. Reads as
 * one control: shared outer border, hairline dividers, selected cell lifts to
 * the top surface step.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  size = "md",
  className,
}: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const h = size === "sm" ? "h-6" : "h-7";
  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded border border-line",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      role="group"
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              h,
              "flex items-center justify-center px-3 text-xs transition-colors duration-fast ease-ease",
              i > 0 && "border-l border-line",
              active
                ? "bg-s3 text-fg"
                : "bg-transparent text-fg-3 hover:bg-s2 hover:text-fg-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter chips for list views. Distinct from Segmented because these are
 * navigational and can number a dozen — so they wrap, and the count carries
 * as much information as the label.
 */
export function FilterBar<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded px-2 transition-colors duration-fast ease-ease",
              active ? "bg-s3 text-fg" : "text-fg-3 hover:bg-s2 hover:text-fg-2",
            )}
          >
            <span className="t-label" style={{ color: "inherit" }}>
              {option.label}
            </span>
            {option.count !== undefined && (
              <span
                className={cn("t-num text-2xs", active ? "text-fg-2" : "text-fg-4")}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
