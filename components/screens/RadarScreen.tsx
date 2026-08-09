"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/Empty";
import { Panel, PanelHeader, Readout, SectionHead } from "@/components/ui/Panel";
import { Status } from "@/components/ui/Status";
import { MomentMarkers, band, type Moment } from "@/components/clips/MomentMarkers";
import { ProcessingStages } from "@/components/clips/ProcessingStages";
import { hms, Waveform } from "@/components/clips/Waveform";
import { relativeTime } from "@/lib/format";
import { sourceStages, statusLabel, statusTone } from "@/lib/stages";
import type { SourceRow } from "@/lib/queries";

const SCANNING = ["pending_download", "downloading", "downloaded", "analyzing"];

interface Detection extends Moment {
  sourceId: string;
  sourceTitle: string | null;
  at: string;
}

/**
 * Radar — the monitoring surface.
 *
 * Not a second dashboard. Overview answers "what should I do"; Radar answers
 * "what is the machine finding, right now". Sources under analysis sit at the
 * top with their candidate strips filling in as the pass proceeds, and every
 * detection across every source lands in one ranked feed underneath.
 *
 * Deliberately a monitoring instrument: nothing here is clickable-to-edit, the
 * figures are live readings, and it is designed to be left open on a second
 * screen while a two-hour episode is processed.
 */
export function RadarScreen({ sources }: { sources: SourceRow[] }) {
  const scanning = useMemo(
    () => sources.filter((s) => SCANNING.includes(s.status)),
    [sources],
  );

  const detections = useMemo<Detection[]>(() => {
    const out: Detection[] = [];
    for (const source of sources) {
      for (const entry of source.radar ?? []) {
        out.push({
          ...entry,
          sourceId: source.id,
          sourceTitle: source.title,
          at: source.updated_at,
        });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [sources]);

  const analyzed = sources.filter((s) => s.status === "analyzed").length;
  const highBand = detections.filter((d) => band(d.score) === "high").length;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-start gap-x-12 gap-y-6 rule-b pb-6">
        <Readout
          value={String(scanning.length).padStart(2, "0")}
          label="under analysis"
          muted={scanning.length === 0}
        />
        <Readout
          value={String(detections.length).padStart(2, "0")}
          label="candidates tracked"
          muted={detections.length === 0}
        />
        <Readout
          value={String(highBand).padStart(2, "0")}
          label="in the high band"
          muted={highBand === 0}
        />
        <Readout
          value={String(analyzed).padStart(2, "0")}
          label="sources complete"
          muted={analyzed === 0}
        />
        {scanning.length > 0 && (
          <span className="ml-auto flex items-center gap-2 pt-1">
            <span
              aria-hidden="true"
              className="anim-pulse block h-[5px] w-[5px] rounded-full bg-fg"
            />
            <span className="t-label text-fg">live</span>
          </span>
        )}
      </div>

      {/* Live analysis --------------------------------------------------- */}
      <section className="mb-10">
        <SectionHead
          title="Live analysis"
          meta={scanning.length > 0 ? `${scanning.length} active` : undefined}
        />

        {scanning.length === 0 ? (
          <p className="py-3 text-sm text-fg-3">
            Nothing under analysis. The feed below is every candidate found in the
            sources already processed.
          </p>
        ) : (
          <div className="space-y-6">
            {scanning.map((source) => (
              <div key={source.id} className="grid gap-5 xl:grid-cols-[1fr_360px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link
                      href={`/projects/${source.id}`}
                      className="t-title min-w-0 truncate transition-colors duration-fast hover:text-fg-2"
                    >
                      {source.title ?? source.source_url}
                    </Link>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className="t-num text-xs text-fg-3">
                        {hms(source.duration_seconds)}
                      </span>
                      <Status
                        tone={statusTone(source.status)}
                        label={statusLabel(source.status)}
                      />
                    </span>
                  </div>

                  <Waveform
                    envelope={source.loudness_envelope}
                    durationSeconds={source.duration_seconds}
                    windows={source.windows}
                    height={40}
                    className="mt-3"
                  />
                  <MomentMarkers
                    moments={source.radar ?? []}
                    durationSeconds={source.duration_seconds}
                    height={40}
                    className="mt-2"
                  />
                </div>

                <div className="min-w-0">
                  <ProcessingStages
                    compact
                    stages={sourceStages(source, 0, source.clipCount)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Detection feed -------------------------------------------------- */}
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Detections"
          count={detections.length}
          actions={
            <span className="t-label">ranked across every source</span>
          }
        />

        {detections.length === 0 ? (
          <EmptyState
            title="No detections"
            body="Candidates appear here as the analyze pass finds them — audio peaks first, then the scored moments once a transcript exists."
          />
        ) : (
          <ol>
            {detections.map((detection, i) => {
              const tier = band(detection.score);
              return (
                <li key={`${detection.sourceId}-${detection.start}-${i}`}>
                  <Link
                    href={`/projects/${detection.sourceId}`}
                    className="row-interactive flex h-row items-center gap-3 rule-b px-3 last:border-b-0"
                  >
                    <span className="t-num w-6 shrink-0 text-2xs text-fg-4">
                      {String(i + 1).padStart(2, "0")}
                    </span>

                    {/* The figure and the band it falls in. There was a bar
                        here too — three renderings of one number in adjacent
                        columns, which is noise rather than emphasis. */}
                    <span
                      className={cn(
                        "t-figure w-8 shrink-0 text-md",
                        tier === "high"
                          ? "text-fg"
                          : tier === "medium"
                            ? "text-fg-2"
                            : "text-fg-3",
                      )}
                    >
                      {Math.round(detection.score)}
                    </span>
                    <span className="t-label w-14 shrink-0">{tier}</span>

                    <span className="t-num w-[72px] shrink-0 text-xs text-fg-2">
                      {hms(detection.start)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-3">
                      {detection.label}
                    </span>
                    <span className="hidden min-w-0 max-w-[30%] shrink truncate text-sm text-fg-4 lg:block">
                      {detection.sourceTitle ?? "Untitled source"}
                    </span>
                    <span className="t-num w-14 shrink-0 text-right text-2xs text-fg-4">
                      {relativeTime(detection.at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <p className="mt-4 max-w-prose text-2xs leading-relaxed text-fg-4">
        Detection is audio energy, scene structure and the transcript, scored for
        craft. It is not a measurement of what anyone watched — no public API
        exposes retention for third-party video, so nothing here claims to.
      </p>
    </>
  );
}
