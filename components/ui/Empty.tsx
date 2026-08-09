import { cn } from "./cn";

/**
 * Empty states are typography and a next action. No illustration, no icon in a
 * circle, no "get started" enthusiasm — a title that names what is absent, one
 * line explaining how it arrives, and the control that makes it happen.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Capped, not centred: the text starts on the same left edge as every
        // other row in the panel, so an empty table reads as the same object
        // that will hold rows rather than as a different kind of screen.
        "flex max-w-prose flex-col items-start justify-center px-6 py-12",
        className,
      )}
    >
      <p className="t-label">{title}</p>
      {body && (
        <p className="mt-2 text-base leading-relaxed text-fg-3">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Loading placeholders shaped like the content they precede, so the layout does
 * not jump when data lands. A flat surface step, no shimmer sweep.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("anim-pulse block rounded-sm bg-s2", className)}
      style={style}
    />
  );
}

/** N table rows' worth of placeholder, at the real row height. */
export function SkeletonRows({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-row items-center gap-3 rule-b px-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-[8px]"
              style={{
                // Varying widths read as data rather than as a loading bar.
                width: `${[38, 16, 12, 20, 10][(r + c) % 5]}%`,
                opacity: 1 - r * 0.1,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
