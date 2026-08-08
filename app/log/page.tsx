import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { relativeTime, timecode } from "@/lib/format";
import { pageContext } from "@/lib/page-context";
import { loadUploads } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  success: "var(--live)",
  failed: "var(--peak)",
  uploading: "var(--lamp)",
  pending: "var(--dim)",
};

export default async function LogPage() {
  const { ownerId, settings, quota } = await pageContext();
  const uploads = await loadUploads(ownerId);

  const succeeded = uploads.filter((u) => u.status === "success").length;
  const failed = uploads.filter((u) => u.status === "failed").length;

  return (
    <Shell
      active="/log"
      quota={quota}
      autoUpload={settings.auto_upload_enabled}
      title="Upload log"
      subtitle="Every upload decision, in order. Each row records what was sent, what YouTube said, and how many quota units it cost."
    >
      <div className="mb-6 flex gap-8">
        <div>
          <p className="display text-3xl" style={{ color: "var(--live)" }}>
            {succeeded}
          </p>
          <p className="eyebrow mt-1">published</p>
        </div>
        <div>
          <p
            className="display text-3xl"
            style={{ color: failed > 0 ? "var(--peak)" : "var(--dim)" }}
          >
            {failed}
          </p>
          <p className="eyebrow mt-1">failed</p>
        </div>
        <div>
          <p className="display text-3xl">
            {(succeeded * quota.unitsPerUpload).toLocaleString()}
          </p>
          <p className="eyebrow mt-1">units spent all-time</p>
        </div>
      </div>

      {uploads.length === 0 ? (
        <div className="panel px-6 py-20 text-center">
          <p className="text-sm text-dim">
            Nothing has been uploaded yet. Approved clips appear here once the
            upload cron runs.
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th className="eyebrow px-4 py-3 text-left">When</th>
                <th className="eyebrow px-4 py-3 text-left">Title</th>
                <th className="eyebrow px-4 py-3 text-left">Window</th>
                <th className="eyebrow px-4 py-3 text-left">Decision</th>
                <th className="eyebrow px-4 py-3 text-right">Units</th>
                <th className="eyebrow px-4 py-3 text-left">Result</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.id} className="border-b border-rule last:border-0">
                  <td className="tc whitespace-nowrap px-4 py-3 text-xs text-dim">
                    {relativeTime(upload.uploaded_at ?? upload.created_at)}
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <span className="block truncate">{upload.title ?? "—"}</span>
                    {upload.error_message && (
                      <span
                        className="mt-1 block text-xs"
                        style={{ color: "var(--peak)" }}
                      >
                        {upload.error_message}
                      </span>
                    )}
                  </td>
                  <td className="tc whitespace-nowrap px-4 py-3 text-xs text-dim">
                    {upload.clip
                      ? `${timecode(upload.clip.start_seconds)}–${timecode(upload.clip.end_seconds)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-dim">
                    {upload.decision ?? "—"}
                  </td>
                  <td className="tc px-4 py-3 text-right text-xs text-dim">
                    {upload.quota_units.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {upload.status === "success" && upload.youtube_url ? (
                      <a
                        href={upload.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="eyebrow underline underline-offset-4"
                        style={{ color: "var(--live)" }}
                      >
                        watch ↗
                      </a>
                    ) : (
                      <span
                        className="eyebrow"
                        style={{ color: STATUS_COLOR[upload.status] }}
                      >
                        {upload.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
