"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/Empty";
import { Modal } from "@/components/ui/Modal";
import { Panel, PanelHeader, Readout, SectionHead } from "@/components/ui/Panel";
import { Status } from "@/components/ui/Status";
import { AddMedia } from "@/components/clips/AddMedia";
import { ProcessingStages } from "@/components/clips/ProcessingStages";
import { hms, Waveform } from "@/components/clips/Waveform";
import { band } from "@/components/clips/MomentMarkers";
import { relativeTime } from "@/lib/format";
import { sourceStages, statusLabel, statusTone } from "@/lib/stages";
import type { Overview as OverviewData } from "@/lib/queries";

/**
 * Overview — the command centre.
 *
 * Answers three questions in reading order and nothing else: what is happening
 * (the active source and its stages), what needs a decision (the ranked
 * opportunities), and what came before (recent sources). It is a structured
 * workspace, not a grid of metric cards — the counts live as a single ruled
 * strip at the top because they are context for the work, not the work.
 */
export function Overview({
  data,
  shortsPerSource,
}: {
  data: OverviewData;
  shortsPerSource: number;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  // The page is force-dynamic, so refreshing it re-runs the real loader rather
  // than reconciling against a second, separately-shaped API response.
  const refresh = useCallback(() => router.refresh(), [router]);
  const { active, activeClips, opportunities, recent, counts } = data;

  if (!active) {
    return (
      <>
        <Panel>
          <PanelHeader title="No sources" />
          <EmptyState
            title="Nothing ingested"
            body="Drop in an episode, stream or VOD. Nexus reads the audio, the scene structure and the transcript, ranks every candidate moment against the others, and cuts the best ones to vertical."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus size={13} strokeWidth={1.5} />
                Add media
              </Button>
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

  const stages = sourceStages(active, activeClips.ready, activeClips.total);

  // Whether the opportunity list spans more than the one source on screen.
  const oneSource =
    opportunities.length > 0 &&
    opportunities.every((o) => o.source_video_id === opportunities[0].source_video_id);

  return (
    <>
      {/* Counts. One strip, mono figures, no boxes. */}
      <div className="mb-8 flex flex-wrap items-start gap-x-12 gap-y-6 rule-b pb-6">
        <Readout
          value={String(counts.needsReview).padStart(2, "0")}
          label="need review"
          muted={counts.needsReview === 0}
        />
        <Readout
          value={String(counts.queued).padStart(2, "0")}
          label="queued to publish"
          muted={counts.queued === 0}
        />
        <Readout
          value={String(counts.published).padStart(2, "0")}
          label="published"
          muted={counts.published === 0}
        />
        <div className="ml-auto flex items-center gap-2">
          {counts.needsReview > 0 && (
            <ButtonLink href="/queue" variant="secondary">
              Review {counts.needsReview}
            </ButtonLink>
          )}
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={13} strokeWidth={1.5} />
            Add media
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-x-10 gap-y-8 xl:grid-cols-2">
        {/* Active source ---------------------------------------------------- */}
        <section>
          <SectionHead
            title="Active source"
            actions={
              <Link
                href={`/projects/${active.id}`}
                className="flex items-center gap-1.5 text-xs text-fg-3 transition-colors duration-fast hover:text-fg"
              >
                Open workspace
                <ArrowUpRight size={12} strokeWidth={1.5} />
              </Link>
            }
          />

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="t-title truncate">
                {active.title ?? active.source_url}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="t-num text-xs text-fg-3">
                  {hms(active.duration_seconds)}
                </span>
                <Status
                  tone={statusTone(active.status)}
                  label={statusLabel(active.status)}
                />
                <span className="t-label">added {relativeTime(active.created_at)}</span>
              </div>
            </div>

            <div className="flex items-baseline gap-6">
              <Readout
                value={String(active.radar?.length ?? 0).padStart(2, "0")}
                label="candidates"
                size="sm"
                muted={(active.radar?.length ?? 0) === 0}
              />
              <Readout
                value={String(activeClips.total).padStart(2, "0")}
                label="clips cut"
                size="sm"
                muted={activeClips.total === 0}
              />
            </div>
          </div>

          <Waveform
            envelope={active.loudness_envelope}
            durationSeconds={active.duration_seconds}
            windows={active.windows}
            height={56}
            className="mt-4"
          />

          <div className="mt-5">
            <h4 className="t-label mb-1">Pipeline</h4>
            <ProcessingStages stages={stages} />
          </div>

          {active.error_message && (
            <p
              role="alert"
              className="mt-4 border-l-2 border-fg bg-s2 py-2 pl-3 text-xs leading-relaxed text-fg"
            >
              {active.error_message}
            </p>
          )}
        </section>

        {/* Opportunities + recents ------------------------------------------ */}
        <div className="space-y-8">
          <section>
            <SectionHead
              title="Top opportunities"
              meta={opportunities.length > 0 ? `${opportunities.length}` : undefined}
              actions={
                opportunities.length > 0 ? (
                  <Link
                    href="/queue"
                    className="text-xs text-fg-3 transition-colors duration-fast hover:text-fg"
                  >
                    Queue
                  </Link>
                ) : undefined
              }
            />

            {opportunities.length === 0 ? (
              <p className="py-4 text-sm text-fg-3">
                No scored clips waiting. Clips are ranked on craft only when the
                worker has an Anthropic key; without one they are still cut and
                cropped, but ordered by audio energy.
              </p>
            ) : (
              <ol>
                {opportunities.map((clip, i) => {
                  const tier = band(clip.score ?? 0);
                  return (
                    <li key={clip.id}>
                      <Link
                        href={`/projects/${clip.source_video_id}?clip=${clip.id}`}
                        className="row-interactive flex h-9 items-center gap-3 rule-b px-1"
                      >
                        <span className="t-num w-5 shrink-0 text-2xs text-fg-4">
                          {String(i + 1).padStart(2, "0")}
                        </span>
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
                          {Math.round(clip.score ?? 0)}
                        </span>
                        <span className="t-num w-[68px] shrink-0 text-xs text-fg-3">
                          {hms(clip.start_seconds)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-fg-2">
                          {/* When every opportunity comes from the source
                              already named above, repeating its title six times
                              says nothing. Fall back to it only when the list
                              actually spans more than one source. */}
                          {oneSource
                            ? (clip.status === "ready_for_review"
                                ? "waiting on a decision"
                                : statusLabel(clip.status))
                            : (clip.sourceTitle ?? "Untitled source")}
                        </span>
                        <span className="t-label w-[86px] shrink-0 text-right">
                          {tier}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section>
            <SectionHead
              title="Recent sources"
              actions={
                <Link
                  href="/projects"
                  className="text-xs text-fg-3 transition-colors duration-fast hover:text-fg"
                >
                  All
                </Link>
              }
            />
            <ul>
              {recent.map((source) => (
                <li key={source.id}>
                  <Link
                    href={`/projects/${source.id}`}
                    className="row-interactive flex h-9 items-center gap-3 rule-b px-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-2">
                      {source.title ?? source.source_url}
                    </span>
                    <span className="t-num shrink-0 text-xs text-fg-4">
                      {hms(source.duration_seconds)}
                    </span>
                    <span className="t-num w-10 shrink-0 text-right text-xs text-fg-3">
                      {source.clipCount > 0 ? `${source.clipCount} cl` : "—"}
                    </span>
                    <span className="w-[104px] shrink-0 text-right">
                      <Status
                        tone={statusTone(source.status)}
                        label={statusLabel(source.status)}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <AddMediaModal
        open={adding}
        onClose={() => setAdding(false)}
        shortsPerSource={shortsPerSource}
        onAdded={refresh}
      />
    </>
  );
}

export function AddMediaModal({
  open,
  onClose,
  shortsPerSource,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  shortsPerSource: number;
  onAdded: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add media" width={520}>
      <AddMedia
        shortsPerSource={shortsPerSource}
        onAdded={() => {
          onAdded();
          onClose();
        }}
      />
    </Modal>
  );
}
