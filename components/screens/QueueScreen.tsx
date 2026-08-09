"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/Empty";
import { Panel, PanelHeader, Readout } from "@/components/ui/Panel";
import { Alert, Status } from "@/components/ui/Status";
import { FilterBar } from "@/components/ui/Tabs";
import { Kbd } from "@/components/ui/Tooltip";
import { ClipInspector } from "@/components/clips/ClipInspector";
import { VideoPlayer } from "@/components/clips/VideoPlayer";
import { band } from "@/components/clips/MomentMarkers";
import { hms } from "@/components/clips/Waveform";
import { statusLabel, statusTone } from "@/lib/stages";
import type { CaptionStyle, ClipWithContext, QuotaSnapshot } from "@/lib/types";

type Bucket = "decide" | "publishing" | "working" | "done" | "all";

const BUCKETS: Record<Exclude<Bucket, "all">, string[]> = {
  decide: ["ready_for_review", "failed"],
  publishing: ["queued", "uploading"],
  working: ["segmented", "cropping", "transcribing", "rendering"],
  done: ["uploaded"],
};

/**
 * Queue — one clip at a time, with the decision on screen.
 *
 * The old review surface was a grid of cards: every clip equally visible, its
 * own player, its own controls, and no way to compare two of them. This is the
 * opposite arrangement. A single list on the left ordered by what is blocked,
 * one monitor and one inspector on the right. J and K walk the list, so a
 * session of thirty clips is thirty keystrokes rather than thirty scroll-and-hunts.
 */
export function QueueScreen({
  clips: initial,
  quota,
  autoUpload,
  defaultCaptionStyle,
}: {
  clips: ClipWithContext[];
  quota: QuotaSnapshot;
  autoUpload: boolean;
  defaultCaptionStyle: CaptionStyle;
}) {
  const router = useRouter();
  const [clips, setClips] = useState(initial);
  const [bucket, setBucket] = useState<Bucket>("decide");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The server is authoritative: re-reads replace the list, and a clip that
  // moved on gets its new status here rather than keeping a stale local copy.
  useEffect(() => setClips(initial), [initial]);

  const counts = useMemo(() => {
    const of = (statuses: string[]) =>
      clips.filter((c) => statuses.includes(c.status)).length;
    return {
      all: clips.length,
      decide: of(BUCKETS.decide),
      publishing: of(BUCKETS.publishing),
      working: of(BUCKETS.working),
      done: of(BUCKETS.done),
    };
  }, [clips]);

  const rows = useMemo(() => {
    const list =
      bucket === "all"
        ? clips
        : clips.filter((c) => BUCKETS[bucket].includes(c.status));
    // Highest score first within a bucket — if only some get reviewed today,
    // the best ones should be the ones that did.
    return [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [clips, bucket]);

  const selected = useMemo(
    () => rows.find((c) => c.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const index = rows.findIndex((c) => c.id === selected?.id);
      const next = Math.max(0, Math.min(rows.length - 1, index + delta));
      setSelectedId(rows[next].id);
    },
    [rows, selected],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k") {
        e.preventDefault();
        move(-1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move]);

  const patchClip = useCallback(
    (id: string, updated: Partial<ClipWithContext>) => {
      setClips((current) =>
        current.map((c) => (c.id === id ? { ...c, ...updated } : c)),
      );
      router.refresh();
    },
    [router],
  );

  // Position in the publish queue decides whether today's quota reaches a clip.
  const publishOrder = useMemo(() => {
    const order = new Map<string, number>();
    let n = 0;
    for (const clip of clips) {
      if (clip.status === "queued") {
        n += 1;
        order.set(clip.id, n);
      }
    }
    return order;
  }, [clips]);

  const scored = clips.filter((c) => c.score != null).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header strip ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rule-b px-4 py-3">
        <Readout
          value={String(counts.decide).padStart(2, "0")}
          label="awaiting a decision"
          size="sm"
          muted={counts.decide === 0}
        />
        <Readout
          value={String(counts.publishing).padStart(2, "0")}
          label="queued to publish"
          size="sm"
          muted={counts.publishing === 0}
        />
        <Readout
          value={`${quota.uploadsRemaining}/${quota.uploadsPerDay}`}
          label="uploads left today"
          size="sm"
          muted={quota.uploadsRemaining === 0}
        />

        <span className="ml-auto flex items-center gap-2">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          <span className="t-label">walk the list</span>
        </span>
      </div>

      {!autoUpload && counts.publishing > 0 && (
        <div className="rule-b px-4 py-2.5">
          <Alert className="max-w-prose">
            Auto-upload is off, so approved clips will sit in the queue. Turn it
            on in{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>{" "}
            to start publishing.
          </Alert>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* List ----------------------------------------------------------- */}
        <div className="flex w-[340px] shrink-0 flex-col border-r border-line 2xl:w-[400px]">
          <div className="flex h-8 shrink-0 items-center rule-b px-2">
            <FilterBar
              options={[
                { value: "decide", label: "Decide", count: counts.decide },
                { value: "publishing", label: "Publishing", count: counts.publishing },
                { value: "working", label: "Working", count: counts.working },
                { value: "done", label: "Done", count: counts.done },
                { value: "all", label: "All", count: counts.all },
              ]}
              value={bucket}
              onChange={(next) => {
                setBucket(next as Bucket);
                setSelectedId(null);
              }}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={bucket === "decide" ? "Nothing to decide" : "Empty"}
              body={
                bucket === "decide"
                  ? "Every clip is queued, publishing, or already out."
                  : "No clips in this state."
              }
            />
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((clip) => {
                const on = clip.id === selected?.id;
                const tier = band(clip.score ?? 0);
                const place = publishOrder.get(clip.id);
                const reachable = place != null && place <= quota.uploadsRemaining;

                return (
                  <li key={clip.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(clip.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rule-b px-3 py-2 text-left transition-colors duration-fast ease-ease",
                        on ? "bg-s3" : "hover:bg-s2",
                      )}
                    >
                      <span
                        className={cn(
                          "t-figure w-7 shrink-0 text-md",
                          tier === "high"
                            ? "text-fg"
                            : tier === "medium"
                              ? "text-fg-2"
                              : "text-fg-3",
                        )}
                      >
                        {clip.score != null ? Math.round(clip.score) : "--"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg-2">
                          {clip.title ?? clip.source?.title ?? "Untitled clip"}
                        </span>
                        <span className="t-num mt-0.5 block text-2xs text-fg-4">
                          {hms(clip.start_seconds)} ·{" "}
                          {Math.round(clip.end_seconds - clip.start_seconds)}s
                          {place != null &&
                            ` · ${reachable ? "goes out next run" : `#${place} in line`}`}
                        </span>
                      </span>

                      <span className="shrink-0">
                        <Status
                          tone={statusTone(clip.status)}
                          label={statusLabel(clip.status)}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Monitor + inspector -------------------------------------------- */}
        {selected ? (
          <div className="flex min-w-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <VideoPlayer
                src={selected.previewUrl}
                vertical
                label="Rendered clip"
                className="min-h-0 flex-1"
              />
            </div>
            <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-line 2xl:w-[380px]">
              <ClipInspector
                clip={selected}
                totalRanked={scored}
                defaultCaptionStyle={defaultCaptionStyle}
                onPatched={(updated) => patchClip(selected.id, updated)}
              />
            </aside>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <Panel className="w-[420px]">
              <PanelHeader title="No clip selected" />
              <EmptyState
                title="Nothing here"
                body="Add a source and Nexus will rank its moments and cut the best ones. They land here for a caption style and a hook before publishing."
              />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
