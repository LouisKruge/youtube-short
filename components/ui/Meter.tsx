import { cn } from "./cn";

/**
 * A determinate bar. 2px tall, square, sitting in a well — a level indicator,
 * not a progress "pill". Brightness carries meaning: a bar that has crossed
 * its own limit goes to full white.
 */
export function ProgressBar({
  value,
  max = 100,
  over,
  height = 2,
  className,
}: {
  value: number;
  max?: number;
  /** Draw at full brightness — used when the value has met or passed a ceiling. */
  over?: boolean;
  height?: number;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <span
      className={cn("relative block w-full overflow-hidden bg-line", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className="absolute inset-y-0 left-0 block transition-[width] duration-slow ease-ease"
        style={{
          width: `${pct * 100}%`,
          background: over ? "var(--fg)" : "var(--fg-2)",
        }}
      />
    </span>
  );
}

/**
 * For stages that genuinely cannot report a percentage. A band traverses the
 * track — honest about not knowing, where a fake 60% would not be.
 */
export function IndeterminateBar({
  height = 2,
  className,
}: {
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative block w-full overflow-hidden bg-line", className)}
      style={{ height }}
      role="progressbar"
      aria-label="In progress"
    >
      <span className="anim-scan absolute inset-y-0 left-0 block w-1/4 bg-fg-2" />
    </span>
  );
}

/**
 * A discrete counter drawn as cells, for quantities small enough to count by
 * eye. The upload quota is six a day; six cells says that better than "6" does,
 * because the shape of what is left is visible without reading.
 */
export function CellMeter({
  total,
  filled,
  label,
  className,
}: {
  total: number;
  filled: number;
  label: string;
  className?: string;
}) {
  // Past a couple of dozen the cells stop being countable and a bar is honest.
  if (total > 24) {
    return (
      <span className={cn("block w-24", className)} aria-label={label}>
        <ProgressBar value={filled} max={total} over={filled >= total} />
      </span>
    );
  }

  return (
    <span
      className={cn("flex items-center gap-[2px]", className)}
      role="img"
      aria-label={label}
    >
      {/* Spent cells are drawn full-brightness and remaining ones as outlines,
          so "two left" is readable as a shape. Equal filled blocks at this size
          read as a glyph rather than as a gauge. */}
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "block h-[9px] w-[2px]",
            i < filled ? "bg-fg-3" : "bg-fg",
          )}
        />
      ))}
    </span>
  );
}

/**
 * A labelled 0–100 factor with its bar — the row used in clip analysis.
 *
 * `weak` dims the whole row and marks the label. Some factors the model can
 * only infer indirectly, and a bar that looks as authoritative as the others
 * would be lying about how much it knows.
 */
export function FactorRow({
  label,
  value,
  weak,
  weakHint,
}: {
  label: string;
  value: number;
  weak?: boolean;
  weakHint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt
        className={cn(
          "t-label w-[104px] shrink-0",
          weak ? "text-fg-4" : "text-fg-3",
        )}
      >
        {label}
        {weak && (
          <span
            title={weakHint}
            aria-label={weakHint}
            className="ml-1 cursor-help border-b border-dotted border-fg-4"
          >
            ?
          </span>
        )}
      </dt>
      <dd className="flex flex-1 items-center gap-3">
        <span className="relative block h-[2px] flex-1 bg-line">
          <span
            className="absolute inset-y-0 left-0 block transition-[width] duration-slow ease-ease"
            style={{
              width: `${Math.max(1, Math.min(100, value))}%`,
              background: weak ? "var(--fg-4)" : "var(--fg-2)",
            }}
          />
        </span>
        <span
          className={cn(
            "t-num w-[22px] text-right text-xs",
            weak ? "text-fg-4" : "text-fg-2",
          )}
        >
          {Math.round(value)}
        </span>
      </dd>
    </div>
  );
}

/**
 * A 14-slot sparkline of daily values. Bars, not a curve — a day is a discrete
 * bucket and drawing it as a continuous line would imply data between them.
 */
export function DayBars({
  values,
  ceiling,
  titles,
  height = 28,
  className,
}: {
  values: number[];
  ceiling: number;
  titles?: string[];
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-end gap-[2px]", className)}
      style={{ height }}
      role="img"
      aria-label={`Daily usage over the last ${values.length} days`}
    >
      {values.map((value, i) => {
        const pct = ceiling <= 0 ? 0 : Math.min(1, value / ceiling);
        const maxed = value >= ceiling;
        return (
          <span
            key={i}
            title={titles?.[i]}
            className="flex-1"
            style={{
              height: `${Math.max(4, pct * 100)}%`,
              background: maxed ? "var(--fg)" : value > 0 ? "var(--fg-3)" : "var(--line)",
            }}
          />
        );
      })}
    </div>
  );
}
