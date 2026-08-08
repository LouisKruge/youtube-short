import type { QuotaSnapshot } from "@/lib/types";

interface Props {
  quota: QuotaSnapshot;
  detailed?: boolean;
}

/**
 * The quota counter.
 *
 * Six cells, because 10,000 units divided by the 1,600 a videos.insert costs
 * is six uploads a day. The cell count is the constraint, not a decoration —
 * raise the ceiling in Settings and the counter grows to match.
 */
export function QuotaMeter({ quota, detailed = false }: Props) {
  const spent = quota.uploadsPerDay - quota.uploadsRemaining;
  const cells = Array.from({ length: quota.uploadsPerDay });
  const exhausted = quota.uploadsRemaining === 0;

  return (
    <div className={detailed ? "space-y-3" : "flex items-center gap-3"}>
      <div className="flex items-center gap-3">
        <div className="flex gap-[3px]" aria-hidden="true">
          {cells.map((_, i) => (
            <span
              key={i}
              className="block h-5 w-[7px] rounded-[1px] border"
              style={{
                background: i < spent ? "var(--lamp)" : "transparent",
                borderColor: i < spent ? "var(--lamp)" : "var(--rule)",
                opacity: i < spent ? 0.9 : 1,
              }}
            />
          ))}
        </div>

        <div className="leading-none">
          <span
            className="tc text-sm font-medium"
            style={{ color: exhausted ? "var(--peak)" : "var(--text)" }}
          >
            {quota.uploadsRemaining}
          </span>
          <span className="tc text-sm text-dim">/{quota.uploadsPerDay}</span>
          {!detailed && (
            <span className="ml-2 eyebrow">
              {exhausted ? "quota spent" : "uploads left"}
            </span>
          )}
        </div>
      </div>

      {detailed && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-dim">Units used today</dt>
          <dd className="tc text-right">
            {quota.unitsUsed.toLocaleString()} / {quota.limit.toLocaleString()}
          </dd>
          <dt className="text-dim">Cost per upload</dt>
          <dd className="tc text-right">{quota.unitsPerUpload.toLocaleString()}</dd>
          <dt className="text-dim">Quota day (Pacific)</dt>
          <dd className="tc text-right">{quota.date}</dd>
        </dl>
      )}
    </div>
  );
}
