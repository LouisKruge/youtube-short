"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Empty";
import { FilterBar } from "@/components/ui/Tabs";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Status } from "@/components/ui/Status";
import { AddMediaModal } from "@/components/screens/Overview";
import { Waveform, hms } from "@/components/clips/Waveform";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/stages";
import type { SourceRow } from "@/lib/queries";

type Filter = "all" | "working" | "ready" | "failed";

const WORKING = ["pending_download", "downloading", "downloaded", "analyzing", "uploading"];

/**
 * Projects — every source, as a dense table.
 *
 * A table rather than a wall of thumbnails because the questions being asked
 * here are comparative: which of these is stuck, which has the most clips, which
 * finished most recently. Thumbnails answer none of those, and forty rows of
 * them would not fit on a screen.
 */
export function ProjectsList({
  sources,
  shortsPerSource,
  openAdd,
}: {
  sources: SourceRow[];
  shortsPerSource: number;
  openAdd?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(Boolean(openAdd));
  const [filter, setFilter] = useState<Filter>("all");
  const refresh = useCallback(() => router.refresh(), [router]);

  const counts = useMemo(
    () => ({
      all: sources.length,
      working: sources.filter((s) => WORKING.includes(s.status)).length,
      ready: sources.filter((s) => s.status === "analyzed").length,
      failed: sources.filter((s) => s.status === "failed").length,
    }),
    [sources],
  );

  const rows = useMemo(() => {
    if (filter === "all") return sources;
    if (filter === "working") return sources.filter((s) => WORKING.includes(s.status));
    if (filter === "ready") return sources.filter((s) => s.status === "analyzed");
    return sources.filter((s) => s.status === "failed");
  }, [sources, filter]);

  const columns: Column<SourceRow>[] = [
    {
      key: "title",
      header: "Project",
      width: "34%",
      sortable: true,
      sortValue: (row) => (row.title ?? row.source_url).toLowerCase(),
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate text-sm text-fg">
            {row.title ?? "Untitled source"}
          </span>
          <span className="t-num mt-0.5 block truncate text-2xs text-fg-4">
            {row.source_url.replace(/^upload:/, "")}
          </span>
        </span>
      ),
    },
    {
      key: "energy",
      header: "Energy",
      width: "18%",
      render: (row) => (
        <Waveform
          envelope={row.loudness_envelope}
          durationSeconds={row.duration_seconds}
          windows={row.windows}
          height={20}
          className="border-0 bg-transparent"
        />
      ),
    },
    {
      key: "duration",
      header: "Length",
      width: "88px",
      align: "right",
      sortable: true,
      sortValue: (row) => row.duration_seconds ?? 0,
      render: (row) => (
        <span className="t-num text-xs text-fg-3">{hms(row.duration_seconds)}</span>
      ),
    },
    {
      key: "clips",
      header: "Clips",
      width: "64px",
      align: "right",
      sortable: true,
      sortValue: (row) => row.clipCount,
      render: (row) => (
        <span className={cn("t-num text-xs", row.clipCount > 0 ? "text-fg-2" : "text-fg-4")}>
          {row.clipCount > 0 ? String(row.clipCount).padStart(2, "0") : "--"}
        </span>
      ),
    },
    {
      key: "scenes",
      header: "Scenes",
      width: "72px",
      align: "right",
      sortable: true,
      sortValue: (row) => row.scene_count ?? 0,
      render: (row) => (
        <span className="t-num text-xs text-fg-4">{row.scene_count ?? "--"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "150px",
      sortable: true,
      sortValue: (row) => row.status,
      render: (row) => (
        <Status tone={statusTone(row.status)} label={statusLabel(row.status)} />
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "88px",
      align: "right",
      sortable: true,
      sortValue: (row) => new Date(row.updated_at).getTime(),
      render: (row) => (
        <span className="t-num text-xs text-fg-4">{relativeTime(row.updated_at)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "working", label: "Working", count: counts.working },
            { value: "ready", label: "Analyzed", count: counts.ready },
            ...(counts.failed > 0
              ? [{ value: "failed" as Filter, label: "Failed", count: counts.failed }]
              : []),
          ]}
          value={filter}
          onChange={setFilter}
        />
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={13} strokeWidth={1.5} />
          Add media
        </Button>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Sources" count={rows.length} />
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/projects/${row.id}`)}
          initialSort={{ key: "updated", dir: "desc" }}
          empty={
            <EmptyState
              title={filter === "all" ? "No sources" : `Nothing ${filter}`}
              body={
                filter === "all"
                  ? "Drop in an episode, stream or VOD to begin analysis."
                  : "Change the filter to see the rest."
              }
              action={
                filter === "all" ? (
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    Add media
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Panel>

      <AddMediaModal
        open={adding}
        onClose={() => setAdding(false)}
        shortsPerSource={shortsPerSource}
        onAdded={refresh}
      />
    </>
  );
}
