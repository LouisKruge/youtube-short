"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * Four variants, and the hierarchy between them is contrast, not colour.
 *
 * `primary` inverts — white plate, black text — which in a monochrome
 * interface is the loudest thing available, so a screen gets at most one.
 * `danger` is deliberately not red: it is a ghost button that only reveals its
 * edge on hover, so destructive actions are quiet until aimed at.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-fg text-bg border border-fg hover:bg-white active:bg-[#e2e2e2] font-medium",
  secondary:
    "bg-s2 text-fg border border-line hover:bg-s3 hover:border-line-strong",
  ghost:
    "bg-transparent text-fg-2 border border-transparent hover:text-fg hover:bg-s2",
  danger:
    "bg-transparent text-fg-3 border border-transparent hover:text-fg hover:border-line-strong hover:bg-s2",
};

const SIZES: Record<Size, string> = {
  sm: "h-6 px-2 text-xs gap-1.5",
  md: "h-7 px-3 text-sm gap-2",
  lg: "h-9 px-4 text-base gap-2",
};

const BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded select-none " +
  "transition-colors duration-fast ease-ease " +
  "disabled:pointer-events-none disabled:opacity-35";

interface Common {
  variant?: Variant;
  size?: Size;
  /** Fills the container width. Use inside narrow panels, not in toolbars. */
  block?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const Button = forwardRef<
  HTMLButtonElement,
  Common & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Button(
  { variant = "secondary", size = "md", block, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Same geometry as Button, for navigation rather than action. */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  block,
  className,
  children,
  ...rest
}: Common & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  >) {
  return (
    <Link
      href={href}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

/**
 * A square button holding a single icon. The label is required — an icon-only
 * control with no accessible name is a dead end for anyone not using a mouse.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    variant?: Variant;
    size?: Size;
    className?: string;
    children: React.ReactNode;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">
>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, ...rest },
  ref,
) {
  const box = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-9 w-9" : "h-7 w-7";
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANTS[variant], box, "px-0", className)}
      {...rest}
    >
      {children}
    </button>
  );
});
