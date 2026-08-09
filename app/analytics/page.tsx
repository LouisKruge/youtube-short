import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/ui/Empty";
import { CellMeter, DayBars } from "@/components/ui/Meter";
import { Panel, PanelHeader, Readout, SectionHead } from "@/components/ui/Panel";
import { Note, Status } from "@/components/ui/Status";
import { hms } from "@/components/clips/Waveform";
import { relativeTime } from "@/lib/format";
import { pageContext } from "@/lib/page-context";
import { loadUploads } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const RESULT_TONE = {
  success: "done",
  failed: "attention",
  uploading: "active",
  pending: "idle",
} as const;

export default async function AnalyticsPage() {
  const { ownerId, email, settings, quota, processing } = await pageContext();
  const db = createAdminClient();

  const [uploads, { data: history }] = await Promise.all([
    loadUploads(ownerId),
    db
      .from("quota_usage")
      .select("usage_date, units_used")
      .eq("owner_id", ownerId)
      .order("usage_date", { ascending: false })
      .limit(14),
  ]);

  const succeeded = uploads.filter((u) => u.status === "success").length;
  const failed = uploads.filter((u) => u.status === "failed").length;
  const unitsAllTime = uploads.reduce((sum, u) => sum + (u.quota_units ?? 0), 0);

  const days = [...(history ?? [])].reverse() as Array<{
    usage_date: string;
    units_used: number;
  }>;

  return (
    <AppShell
      crumbs={[{ label: "Analytics" }]}
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      processing={processing}
      email={email}
    >
      <PageHeader
        title="Analytics"
        description="Publishing history and quota spend, from Nexus's own records."
      />

      {/* Totals ----------------------------------------------------------- */}
      <div className="mb-10 flex flex-wrap items-start gap-x-12 gap-y-6 rule-b pb-6">
        <Readout
          value={String(succeeded).padStart(2, "0")}
          label="published"
          muted={succeeded === 0}
        />
        <Readout
          value={String(failed).padStart(2, "0")}
          label="failed"
          muted={failed === 0}
        />
        <Readout
          value={unitsAllTime.toLocaleString()}
          label="quota units spent"
          muted={unitsAllTime === 0}
        />
        <Readout
          value={`${quota.uploadsRemaining}/${quota.uploadsPerDay}`}
          label="uploads left today"
          muted={quota.uploadsRemaining === 0}
        />
      </div>

      <div className="grid gap-10 xl:grid-cols-[1fr_320px]">
        {/* Upload log ----------------------------------------------------- */}
        <div className="min-w-0">
          <SectionHead title="Upload log" meta={`${uploads.length} rows`} />

          {uploads.length === 0 ? (
            <Panel>
              <EmptyState
                title="Nothing published"
                body="Approved clips are uploaded by the worker within quota. Each attempt lands here with what was sent and what YouTube said."
              />
            </Panel>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <colgroup>
                  <col style={{ width: 84 }} />
                  <col />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr className="rule-b bg-s2">
                    <th scope="col" className="h-7 px-3 text-left">
                      <span className="t-label">When</span>
                    </th>
                    <th scope="col" className="h-7 px-3 text-left">
                      <span className="t-label">Title</span>
                    </th>
                    <th scope="col" className="h-7 px-3 text-left">
                      <span className="t-label">Window</span>
                    </th>
                    <th scope="col" className="h-7 px-3 text-right">
                      <span className="t-label">Units</span>
                    </th>
                    <th scope="col" className="h-7 px-3 text-left">
                      <span className="t-label">Result</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((upload) => (
                    <tr key={upload.id} className="rule-b last:border-b-0 hover:bg-s2">
                      <td className="h-row px-3">
                        <span className="t-num whitespace-nowrap text-xs text-fg-4">
                          {relativeTime(upload.uploaded_at ?? upload.created_at)}
                        </span>
                      </td>
                      <td className="h-row max-w-0 px-3">
                        <span className="block truncate text-sm text-fg-2">
                          {upload.title ?? "—"}
                        </span>
                        {upload.error_message && (
                          <span className="mt-0.5 block truncate text-xs text-fg">
                            {upload.error_message}
                          </span>
                        )}
                      </td>
                      <td className="h-row px-3">
                        <span className="t-num whitespace-nowrap text-xs text-fg-4">
                          {upload.clip
                            ? `${hms(upload.clip.start_seconds)}–${hms(upload.clip.end_seconds)}`
                            : "—"}
                        </span>
                      </td>
                      <td className="h-row px-3 text-right">
                        <span className="t-num text-xs text-fg-3">
                          {upload.quota_units.toLocaleString()}
                        </span>
                      </td>
                      <td className="h-row px-3">
                        {upload.status === "success" && upload.youtube_url ? (
                          <a
                            href={upload.youtube_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-fg-2 transition-colors duration-fast hover:text-fg"
                          >
                            <span className="t-label text-fg">watch</span>
                            <ArrowUpRight size={11} strokeWidth={1.5} />
                          </a>
                        ) : (
                          <Status
                            tone={RESULT_TONE[upload.status]}
                            label={upload.status}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quota ---------------------------------------------------------- */}
        <div className="space-y-10">
          <section>
            <SectionHead title="Quota" />

            <div className="flex items-center gap-3">
              <CellMeter
                total={quota.uploadsPerDay}
                filled={quota.uploadsPerDay - quota.uploadsRemaining}
                label={`${quota.uploadsRemaining} uploads remaining`}
                className="scale-y-150"
              />
              <span className="t-num text-md text-fg">
                {quota.uploadsRemaining}
                <span className="text-fg-4">/{quota.uploadsPerDay}</span>
              </span>
            </div>

            <dl className="mt-4 space-y-2">
              <QuotaRow
                label="Units today"
                value={`${quota.unitsUsed.toLocaleString()} / ${quota.limit.toLocaleString()}`}
              />
              <QuotaRow
                label="Cost per upload"
                value={quota.unitsPerUpload.toLocaleString()}
              />
              <QuotaRow label="Quota day (Pacific)" value={quota.date} />
            </dl>

            {days.length > 0 && (
              <div className="mt-5">
                <p className="t-label mb-2">Last {days.length} days</p>
                <DayBars
                  values={days.map((d) => Number(d.units_used))}
                  ceiling={quota.limit}
                  titles={days.map(
                    (d) =>
                      `${d.usage_date}: ${Number(d.units_used).toLocaleString()} units`,
                  )}
                  height={32}
                />
                <div className="mt-1 flex justify-between">
                  <span className="t-num text-2xs text-fg-4">
                    {days[0]?.usage_date}
                  </span>
                  <span className="t-num text-2xs text-fg-4">
                    {days[days.length - 1]?.usage_date}
                  </span>
                </div>
              </div>
            )}

            <Note className="mt-4">
              A videos.insert costs {quota.unitsPerUpload.toLocaleString()} of the{" "}
              {quota.limit.toLocaleString()} units Google grants per day, and the
              charge lands whether or not the upload succeeds. The day rolls over
              at midnight Pacific, not UTC. Raising the ceiling is a manual
              application in the Cloud Console that takes weeks — Nexus cannot
              request one.
            </Note>
          </section>

          {/* Performance data. Absent, and said so rather than faked. */}
          <section>
            <SectionHead title="Channel performance" />
            <p className="text-sm leading-relaxed text-fg-3">
              Views, watch time and retention for your published clips are{" "}
              <span className="text-fg-2">not wired up</span>. Reading them needs
              the <span className="t-num text-fg-2">yt-analytics.readonly</span>{" "}
              scope on the connected channel and a worker stage to pull them —
              both possible for your own uploads, neither built.
            </p>
            <Note className="mt-3">
              Nothing on this page is a prediction. It is a record of what Nexus
              sent and what it cost.
            </Note>
            <Link
              href="/settings"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-fg-3 transition-colors duration-fast hover:text-fg"
            >
              Channel connection
              <ArrowUpRight size={11} strokeWidth={1.5} />
            </Link>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function QuotaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rule-b pb-2 last:border-b-0">
      <dt className="t-label">{label}</dt>
      <dd className="t-num text-xs text-fg-2">{value}</dd>
    </div>
  );
}
