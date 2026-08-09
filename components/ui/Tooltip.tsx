"use client";

import { useState } from "react";
import { cn } from "./cn";

/**
 * A hover readout. Not a help bubble — the timeline uses it to surface a
 * marker's score and timecode, which is data, so it is set in the same mono
 * figures as the rest of the interface.
 *
 * No arrow, no shadow, no delay animation. It appears at 150ms and it is a
 * plate with a hairline, like everything else.
 */
export function Tooltip({
  content,
  side = "top",
  className,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded border border-line-strong bg-raised px-2 py-1",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * The keyboard hint form: a key cap. Used in the command palette and shortcut
 * lists so a shortcut looks like something you press.
 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="t-num inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-sm border border-line-strong bg-s2 px-1 text-2xs text-fg-3">
      {children}
    </kbd>
  );
}
