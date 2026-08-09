import { cn } from "./cn";

/**
 * The only container in the product.
 *
 * A panel is a hairline and one step of brightness. It never nests inside
 * another panel — where a subdivision is needed, `PanelSection` draws a rule
 * instead, which keeps the border count from compounding into a grid of boxes.
 */
export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("surface", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * A panel's title bar. Kept to 32px so the panel reads as an instrument module
 * rather than a page — the title is a plate marking, not a heading.
 */
export function PanelHeader({
  title,
  count,
  actions,
  className,
}: {
  title: string;
  /** A figure that belongs to the title, e.g. how many rows follow. */
  count?: string | number;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-center justify-between gap-4 rule-b px-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="t-label truncate">{title}</h2>
        {count !== undefined && (
          <span className="t-num text-2xs text-fg-4">{count}</span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** A ruled subdivision inside a panel. Avoids nesting bordered boxes. */
export function PanelSection({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rule-t px-3 py-3 first:border-t-0", className)}>
      {label && <h3 className="t-label mb-2">{label}</h3>}
      {children}
    </section>
  );
}

/**
 * A screen-level section separator: a label sitting on a rule that runs the
 * full width. This is what gives the workspace its editorial structure without
 * wrapping every group in a card.
 */
export function SectionHead({
  title,
  meta,
  actions,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex min-h-6 items-baseline justify-between gap-4 rule-b pb-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="t-label">{title}</h2>
        {meta && <span className="t-num text-2xs text-fg-4">{meta}</span>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}

/**
 * A figure with its label beneath — the readout unit used in headers and
 * summaries. Label under value, because the value is what is being read.
 */
export function Readout({
  value,
  label,
  size = "md",
  muted,
  className,
}: {
  value: React.ReactNode;
  label: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}) {
  const scale = {
    sm: "text-md",
    md: "text-2xl",
    lg: "text-4xl",
  }[size];

  return (
    <div className={cn("min-w-0", className)}>
      <p
        className={cn("t-figure", scale, muted ? "text-fg-3" : "text-fg")}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      <p className="t-label mt-1.5 truncate">{label}</p>
    </div>
  );
}
