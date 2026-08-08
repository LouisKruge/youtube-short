const FACTOR_LABELS: Record<string, string> = {
  hook: "Hook",
  emotional_intensity: "Emotion",
  curiosity: "Curiosity",
  dialogue: "Dialogue",
  pacing: "Pacing",
  visual_activity: "Visual",
  ending: "Ending",
};

/**
 * Factors the model can only infer weakly. Flagged in the UI so the operator
 * knows which bars to trust — visual activity is guessed from scene-cut counts
 * and what the speech implies, because nothing here watches the video.
 */
const WEAK_FACTORS = new Set(["visual_activity"]);

interface Props {
  score: number | null;
  factors: Record<string, number> | null;
  rationale?: string | null;
  category?: string | null;
  rank?: number | null;
  compact?: boolean;
}

export function ScoreBreakdown({
  score,
  factors,
  rationale,
  category,
  rank,
  compact = false,
}: Props) {
  if (score == null) {
    return <span className="eyebrow">Not yet scored</span>;
  }

  const colour =
    score >= 70 ? "var(--lamp)" : score >= 45 ? "var(--text)" : "var(--dim)";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        {rank != null && (
          <span className="tc text-xs text-dim">#{String(rank).padStart(2, "0")}</span>
        )}
        <span className="display text-3xl" style={{ color: colour }}>
          {Math.round(score)}
        </span>
        <span className="eyebrow">clip score</span>
        {category && category !== "unrated" && (
          <span
            className="eyebrow ml-auto rounded-[2px] px-2 py-0.5"
            style={{ background: "var(--panel-2)", color: "var(--synth)" }}
          >
            {category}
          </span>
        )}
      </div>

      {!compact && factors && (
        <dl className="space-y-1.5">
          {Object.entries(FACTOR_LABELS).map(([key, label]) => {
            const value = Number(factors[key]);
            if (!Number.isFinite(value)) return null;
            const weak = WEAK_FACTORS.has(key);

            return (
              <div key={key} className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[11px] text-dim">
                  {label}
                  {weak && (
                    <span
                      title="Inferred from scene cuts and speech — nothing here watches the video"
                      className="ml-1 cursor-help"
                      style={{ color: "var(--dim)" }}
                    >
                      ?
                    </span>
                  )}
                </dt>
                <dd className="flex flex-1 items-center gap-2">
                  <span
                    className="block h-[3px] flex-1 overflow-hidden rounded-full"
                    style={{ background: "var(--rule)" }}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, value)}%`,
                        background: weak ? "var(--dim)" : "var(--lamp)",
                        opacity: weak ? 0.55 : 0.9,
                      }}
                    />
                  </span>
                  <span className="tc w-7 text-right text-[11px] text-dim">
                    {Math.round(value)}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {rationale && (
        <p className="text-xs leading-relaxed text-dim">
          <span className="eyebrow mr-1" style={{ color: "var(--synth)" }}>
            why
          </span>
          {rationale}
        </p>
      )}

      {!compact && (
        <p className="text-[10px] leading-relaxed text-dim">
          Ranked against the other moments in this video on craft. Not a
          prediction of views.
        </p>
      )}
    </div>
  );
}
