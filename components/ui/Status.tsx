import { cn } from "./cn";

/**
 * State without colour.
 *
 * The palette has no red or green to spend, so state is encoded in shape and
 * brightness instead — which turns out to be more legible at 6px than hue is
 * anyway, and survives being screenshotted, printed or looked at by someone
 * who cannot separate red from green.
 *
 *   ○ hollow ring   waiting — nothing has happened yet
 *   ◐ pulsing dot   in flight — the worker is on it
 *   ● filled dot    done
 *   ■ filled square needs attention — failed, or blocked on the operator
 *   ╱ struck ring   dismissed — rejected, skipped, disconnected
 */
export type Tone = "idle" | "active" | "done" | "attention" | "dismissed";

export function StatusDot({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  const box = "block h-[6px] w-[6px] shrink-0";

  if (tone === "attention") {
    return (
      <span aria-hidden="true" className={cn(box, "bg-fg", className)} />
    );
  }

  if (tone === "dismissed") {
    return (
      <span
        aria-hidden="true"
        className={cn(box, "relative rounded-full border border-fg-4", className)}
      >
        <span className="absolute left-[-1px] top-[2px] block h-[1px] w-[8px] rotate-45 bg-fg-4" />
      </span>
    );
  }

  if (tone === "active") {
    return (
      <span
        aria-hidden="true"
        className={cn(box, "anim-pulse rounded-full bg-fg-2", className)}
      />
    );
  }

  if (tone === "done") {
    return <span aria-hidden="true" className={cn(box, "rounded-full bg-fg", className)} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(box, "rounded-full border border-fg-4", className)}
    />
  );
}

const TEXT: Record<Tone, string> = {
  idle: "text-fg-3",
  active: "text-fg-2",
  done: "text-fg",
  attention: "text-fg",
  dismissed: "text-fg-4",
};

/** Dot plus label. The label is always the source of truth for screen readers. */
export function Status({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <StatusDot tone={tone} />
      <span className={cn("t-label", TEXT[tone])}>{label}</span>
    </span>
  );
}

/**
 * A short bright rule with a message — how failures are reported in a palette
 * with no red. The rule is full-brightness white against a near-black field,
 * which is the highest-contrast mark available and reads as an alarm.
 */
export function Alert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "border-l-2 border-fg bg-s2 py-2 pl-3 pr-3 text-xs leading-relaxed text-fg",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A quiet inline notice. No border, no icon — just recessed text. */
export function Note({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("max-w-prose text-xs leading-relaxed text-fg-3", className)}>
      {children}
    </p>
  );
}
