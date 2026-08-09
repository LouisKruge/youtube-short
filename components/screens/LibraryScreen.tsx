"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DataTable, SelectionBar, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Field";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Alert, Status } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { ScoreCell } from "@/components/clips/ClipAnalysis";
import { hms } from "@/components/clips/Waveform";
import { relativeTime } from "@/lib/format";
import { statusLabel, statusTone } from "@/lib/stages";
import { LIBRARY_STATUSES, type ClipWithContext, type LibraryStatus } from "@/lib/types";

/**
 * Library status labels.
 *
 * The stored values are the pipeline's; these are the operator's words for the
 * same states. `rejected` is shown as "Archived" because in a library context
 * that is what it means — set aside, still there.
 */
const TAB_LABEL: Record<LibraryStatus, string> = {
  unreviewed: "Unreviewed",
  shortlisted: "Shortlisted",
  edited: "Editing",
  exported: "Exported",
  published: "Published",
  rejected: "Archived",
};

/** The moves worth one click from a selection, in workflow order. */
const BATCH_MOVES: LibraryStatus[] = ["shortlisted", "exported", "rejected"];

interface SearchHit {
  source_video_id: string;
  source_title: string | null;
  headline: string;
}

/**
 * Library — every clip ever cut, plus full-text search over every transcript.
 *
 * Density is the whole point: a hundred rows on one screen, sortable by score or
 * length or recency, so the question "which of these is worth exporting" is
 * answered by looking down a column. Thumbnails were the first thing cut — they
 * are the least informative thing about a clip and the most expensive to show.
 */
export function LibraryScreen({ clips: initial }: { clips: ClipWithContext[] }) {
  const router = useRouter();
  const toast = useToast();
  const [clips, setClips] = useState(initial);
  const [tab, setTab] = useState<LibraryStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => setClips(initial), [initial]);

  // Debounced transcript search. Two characters is the floor — a single letter
  // matches most of a two-hour episode and tells the operator nothing.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits(null);
      setSearchError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          cache: "no-store",
        });
        const payload = await res.json();
        if (res.ok) {
          setHits(payload);
          setSearchError(null);
        } else {
          setHits(null);
          setSearchError(payload.error ?? "Search failed.");
        }
      } catch {
        setSearchError("Search failed.");
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: clips.length };
    for (const status of LIBRARY_STATUSES) {
      out[status] = clips.filter((c) => c.library_status === status).length;
    }
    return out;
  }, [clips]);

  const rows = useMemo(
    () => (tab === "all" ? clips : clips.filter((c) => c.library_status === tab)),
    [clips, tab],
  );

  const setStatus = useCallback(
    async (ids: string[], status: LibraryStatus) => {
      setBusy(true);
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const res = await fetch(`/api/clips/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ libraryStatus: status }),
            });
            return res.ok ? { id, updated: await res.json() } : null;
          }),
        );

        const applied = results.filter(
          (r): r is { id: string; updated: Partial<ClipWithContext> } => r !== null,
        );

        setClips((current) =>
          current.map((clip) => {
            const hit = applied.find((a) => a.id === clip.id);
            return hit ? { ...clip, ...hit.updated } : clip;
          }),
        );

        const failed = ids.length - applied.length;
        toast(
          failed > 0
            ? `${applied.length} moved, ${failed} failed`
            : `${applied.length} → ${TAB_LABEL[status].toLowerCase()}`,
          failed > 0 ? "attention" : "info",
        );
        setSelected(new Set());
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [toast, router],
  );

  const columns: Column<ClipWithContext>[] = [
    {
      key: "score",
      header: "Score",
      width: "84px",
      sortable: true,
      sortValue: (row) => row.score ?? -1,
      render: (row) => <ScoreCell score={row.score} rank={row.rank} />,
    },
    {
      key: "title",
      header: "Clip",
      width: "26%",
      sortable: true,
      sortValue: (row) => (row.title ?? "").toLowerCase(),
      render: (row) => (
        <span className="block min-w-0 truncate text-sm text-fg">
          {row.title ?? "Untitled clip"}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      width: "22%",
      sortable: true,
      sortValue: (row) => (row.source?.title ?? "").toLowerCase(),
      render: (row) => (
        <span className="block min-w-0 truncate text-sm text-fg-3">
          {row.source?.title ?? "—"}
        </span>
      ),
    },
    {
      key: "window",
      header: "In",
      width: "84px",
      align: "right",
      sortable: true,
      sortValue: (row) => row.start_seconds,
      render: (row) => (
        <span className="t-num text-xs text-fg-3">{hms(row.start_seconds)}</span>
      ),
    },
    {
      key: "length",
      header: "Length",
      width: "64px",
      align: "right",
      sortable: true,
      sortValue: (row) => row.end_seconds - row.start_seconds,
      render: (row) => (
        <span className="t-num text-xs text-fg-3">
          {Math.round(row.end_seconds - row.start_seconds)}s
        </span>
      ),
    },
    {
      key: "captions",
      header: "Captions",
      width: "108px",
      render: (row) => (
        <span className="t-label">
          {row.caption_style
            ? `${row.caption_style === "karaoke" ? "word" : "line"} · ${row.caption_preset}`
            : "—"}
        </span>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      width: "152px",
      sortable: true,
      sortValue: (row) => row.status,
      render: (row) => (
        <Status tone={statusTone(row.status)} label={statusLabel(row.status)} />
      ),
    },
    {
      key: "library",
      header: "Shelf",
      width: "104px",
      sortable: true,
      sortValue: (row) => row.library_status,
      render: (row) => (
        <span className="t-label text-fg-3">{TAB_LABEL[row.library_status]}</span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      width: "80px",
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
      {/* Search ----------------------------------------------------------- */}
      <div className="mb-6 max-w-[560px]">
        <div className="relative">
          <Search
            size={13}
            strokeWidth={1.5}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search everything anyone said in every source"
            aria-label="Search transcripts"
            className="h-9 pl-8 text-md"
          />
          {searching && (
            <span className="t-label absolute right-3 top-1/2 -translate-y-1/2">
              searching
            </span>
          )}
        </div>

        {searchError && <Alert className="mt-2">{searchError}</Alert>}

        {hits && !searching && (
          <div className="mt-2">
            {hits.length === 0 ? (
              <p className="py-2 text-sm text-fg-3">
                Nothing matched. Only sources that finished transcribing are
                searchable.
              </p>
            ) : (
              <ul className="surface overflow-hidden">
                {hits.map((hit) => (
                  <li key={hit.source_video_id}>
                    <a
                      href={`/projects/${hit.source_video_id}`}
                      className="row-interactive block px-3 py-2 rule-b last:border-b-0"
                    >
                      <span className="block truncate text-sm text-fg-2">
                        {hit.source_title ?? "Untitled source"}
                      </span>
                      {/* ts_headline wraps matches in <b>; generated by Postgres
                          from our own transcript column, not by a user. */}
                      <span
                        className="mt-0.5 block text-xs leading-relaxed text-fg-3 [&_b]:font-normal [&_b]:text-fg"
                        dangerouslySetInnerHTML={{ __html: hit.headline }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Shelves ---------------------------------------------------------- */}
      <Tabs
        items={[
          { value: "all", label: "All", count: counts.all },
          ...LIBRARY_STATUSES.map((status) => ({
            value: status,
            label: TAB_LABEL[status],
            count: counts[status],
          })),
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next as LibraryStatus | "all");
          setSelected(new Set());
        }}
        className="mb-4"
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          title={tab === "all" ? "All clips" : TAB_LABEL[tab as LibraryStatus]}
          count={rows.length}
        />
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(row) =>
            router.push(`/projects/${row.source_video_id}?clip=${row.id}`)
          }
          initialSort={{ key: "score", dir: "desc" }}
          empty={
            <EmptyState
              title={tab === "all" ? "No clips" : `Nothing on this shelf`}
              body={
                tab === "all"
                  ? "Clips appear here as soon as a source has been analyzed and cut."
                  : "Move clips here from another shelf, or change the filter."
              }
            />
          }
        />
      </Panel>

      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {BATCH_MOVES.map((status) => (
          <Button
            key={status}
            size="sm"
            disabled={busy}
            onClick={() => setStatus(Array.from(selected), status)}
          >
            {TAB_LABEL[status]}
          </Button>
        ))}
      </SelectionBar>
    </>
  );
}
