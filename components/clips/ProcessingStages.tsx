import { cn } from "@/components/ui/cn";
import { IndeterminateBar, ProgressBar } from "@/components/ui/Meter";
import { StatusDot } from "@/components/ui/Status";
import type { Stage, StageState } from "@/lib/stages";

const TONE: Record<StageState, "idle" | "active" | "done" | "attention" | "dismissed"> =
  {
    waiting: "idle",
    running: "active",
    complete: "done",
    failed: "attention",
    skipped: "dismissed",
  };

const STATE_TEXT: Record<StageState, string> = {
  waiting: "Waiting",
  running: "Processing",
  complete: "Complete",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * Short forms for the narrow column. Whole words, not truncations — "COMP" and
 * "PROC" are four characters the reader has to decode, which is worse than the
 * two extra characters they saved.
 */
const STATE_SHORT: Record<StageState, string> = {
  waiting: "waiting",
  running: "running",
  complete: "done",
  failed: "failed",
  skipped: "skipped",
};

/**
 * The processing readout: one row per stage, state hard right.
 *
 * A stage that can report a fraction gets a determinate bar; one that cannot
 * gets a traversing band rather than a fabricated percentage.
 *
 * Two densities, because this appears both in a wide column and in a 360px
 * sidebar. `compact` drops the bar and the detail figure and moves the state to
 * a dot plus a short word — the alternative was reserving 230px of fixed
 * right-hand slots in a 360px box, which starved the labels down to "Retrieve
 * so…" and "Moment sc…". A stage name that cannot be read is not a readout.
 */
export function ProcessingStages({
  stages,
  compact,
  note,
  className,
}: {
  stages: Stage[];
  compact?: boolean;
  /** A failure that is being retried. Shown under the list, not on a row —
      the stage that threw is not always the one still marked running. */
  note?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <ol className="space-y-0">
      {stages.map((stage) => (
        <li
          key={stage.label}
          className="flex h-7 items-center gap-2.5 rule-b last:border-b-0"
        >
          <StatusDot tone={TONE[stage.state]} />

          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              stage.state === "waiting"
                ? "text-fg-4"
                : stage.state === "complete"
                  ? "text-fg-2"
                  : "text-fg",
            )}
          >
            {stage.label}
          </span>

          {/* Wide form: a fixed bar slot and a detail figure, so the columns
              hold their positions as work advances down the list. */}
          {!compact && (
            <>
              <span className="hidden w-[88px] shrink-0 sm:block">
                {stage.state === "running" &&
                  (stage.progress != null ? (
                    <ProgressBar value={stage.progress} max={1} />
                  ) : (
                    <IndeterminateBar />
                  ))}
              </span>
              <span className="t-num hidden w-[84px] shrink-0 truncate text-right text-xs text-fg-4 md:block">
                {stage.detail ?? ""}
              </span>
            </>
          )}

          {/* Compact form: the running stage still gets a bar, but a narrow one
              that shares the row rather than claiming a reserved column. */}
          {compact && stage.state === "running" && (
            <span className="w-10 shrink-0">
              {stage.progress != null ? (
                <ProgressBar value={stage.progress} max={1} />
              ) : (
                <IndeterminateBar />
              )}
            </span>
          )}

          <span
            className={cn(
              "t-label shrink-0 text-right",
              compact ? "w-[56px]" : "w-[68px]",
              stage.state === "complete" && "text-fg-3",
              stage.state === "running" && "text-fg-2",
              stage.state === "failed" && "text-fg",
              stage.state === "waiting" && "text-fg-4",
            )}
          >
            {compact ? STATE_SHORT[stage.state] : STATE_TEXT[stage.state]}
          </span>
        </li>
      ))}
      </ol>

      {note && (
        <p className="mt-2.5 flex gap-2 text-xs leading-relaxed text-fg-3">
          <span className="mt-[3px] shrink-0">
            <StatusDot tone="attention" />
          </span>
          <span className="min-w-0">{note}</span>
        </p>
      )}
    </div>
  );
}
