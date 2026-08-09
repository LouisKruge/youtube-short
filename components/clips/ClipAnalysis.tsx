import { cn } from "@/components/ui/cn";
import { FactorRow } from "@/components/ui/Meter";
import { band } from "./MomentMarkers";

/**
 * Factor labels, in the order they are weighted.
 *
 * `ending` is shown as "Payoff" because that is what it measures — whether the
 * moment lands rather than trails off. `visual_activity` is last and weighted at
 * 4%, and it is the one factor the model can only infer indirectly.
 */
const FACTORS: Array<{ key: string; label: string; weak?: boolean }> = [
  { key: "hook", label: "Hook" },
  { key: "curiosity", label: "Curiosity" },
  { key: "emotional_intensity", label: "Emotional" },
  { key: "dialogue", label: "Dialogue" },
  { key: "ending", label: "Payoff" },
  { key: "pacing", label: "Pacing" },
  { key: "visual_activity", label: "Visual", weak: true },
];

const WEAK_HINT =
  "Inferred from scene-cut density and what the speech implies. Nothing in the pipeline watches the video, so this factor is weighted at 4%.";

/**
 * The analysis panel.
 *
 * The score is the largest figure on the screen because it is what the operator
 * came to read — but it is a rank within this one source, computed on craft, and
 * the panel says so at the bottom rather than dressing it up as a forecast.
 * There is no "viral" band and no predicted view count: nothing here can see
 * view counts, so any such number would be invented.
 */
export function ClipAnalysis({
  score,
  factors,
  rationale,
  category,
  rank,
  totalRanked,
  className,
}: {
  score: number | null;
  factors: Record<string, number> | null;
  rationale?: string | null;
  category?: string | null;
  rank?: number | null;
  totalRanked?: number;
  className?: string;
}) {
  if (score == null) {
    return (
      <div className={cn("px-3 py-6", className)}>
        <p className="t-label">not scored</p>
        <p className="mt-2 text-xs leading-relaxed text-fg-3">
          Craft ranking needs an Anthropic key on the worker. This clip was
          picked on audio energy — loudness, scene changes and speech density.
          That is a proxy for where attention might be, not a measure of it.
        </p>
      </div>
    );
  }

  const tier = band(score);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="t-label">clip score</p>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span
              className={cn(
                "t-figure text-4xl",
                tier === "low" ? "text-fg-3" : "text-fg",
              )}
            >
              {Math.round(score)}
            </span>
            <span className="t-label text-fg-2">{tier}</span>
          </div>
        </div>

        <div className="text-right">
          {rank != null && (
            <>
              <p className="t-label">rank</p>
              <p className="t-num mt-1.5 text-md text-fg-2">
                {String(rank).padStart(2, "0")}
                {totalRanked ? (
                  <span className="text-fg-4">/{totalRanked}</span>
                ) : null}
              </p>
            </>
          )}
          {category && category !== "unrated" && (
            <p className="t-label mt-2 text-fg-3">{category}</p>
          )}
        </div>
      </div>

      {factors && (
        <dl className="space-y-2">
          {FACTORS.map(({ key, label, weak }) => {
            const value = Number(factors[key]);
            if (!Number.isFinite(value)) return null;
            return (
              <FactorRow
                key={key}
                label={label}
                value={value}
                weak={weak}
                weakHint={weak ? WEAK_HINT : undefined}
              />
            );
          })}
        </dl>
      )}

      {rationale && (
        <div className="rule-t pt-3">
          <p className="t-label">assessment</p>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-fg-2">
            {rationale}
          </p>
        </div>
      )}

      <p className="text-2xs leading-relaxed text-fg-4">
        Ranked against the other candidates in this source on craft — hook,
        payoff, pacing. Not a prediction of views.
      </p>
    </div>
  );
}

/**
 * The one-line form for dense lists: score, band and rank with no bars. Used in
 * table cells, where the factor breakdown would not fit and the number is the
 * only thing being compared.
 */
export function ScoreCell({
  score,
  rank,
}: {
  score: number | null;
  rank?: number | null;
}) {
  if (score == null) {
    return <span className="t-num text-xs text-fg-4">--</span>;
  }
  const tier = band(score);
  return (
    <span className="flex items-baseline gap-2">
      <span
        className={cn(
          "t-figure text-md",
          tier === "high" ? "text-fg" : tier === "medium" ? "text-fg-2" : "text-fg-3",
        )}
      >
        {Math.round(score)}
      </span>
      {rank != null && (
        <span className="t-num text-2xs text-fg-4">#{String(rank).padStart(2, "0")}</span>
      )}
    </span>
  );
}
