"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/Empty";
import { Segmented, Tabs } from "@/components/ui/Tabs";
import { Status } from "@/components/ui/Status";
import { CaptionReadout, CaptionTrack } from "@/components/clips/CaptionTrack";
import { ClipInspector } from "@/components/clips/ClipInspector";
import { MomentMarkers, band, type Moment } from "@/components/clips/MomentMarkers";
import { ProcessingStages } from "@/components/clips/ProcessingStages";
import { VideoPlayer, tc, type PlayerHandle } from "@/components/clips/VideoPlayer";
import { hms, TimeScale, Waveform } from "@/components/clips/Waveform";
import { retryNotice, sourceStages, statusLabel, statusTone } from "@/lib/stages";
import type { ProjectDetail } from "@/lib/queries";
import type { CaptionStyle, ClipWithContext } from "@/lib/types";

type Feed = "source" | "clip";
type Panel = "clips" | "pipeline";

/**
 * The project workspace.
 *
 * Three regions on one screen and one playhead between them: the monitor with
 * its transport, the timeline stack under it, and the clip panel on the right.
 * Selecting a clip in the panel moves the playhead; clicking a moment on the
 * timeline selects the clip that came from it. The operator never loses their
 * place because there is only ever one place.
 *
 * The whole screen owns the viewport — it does not scroll as a page. Each region
 * scrolls itself, which is the difference between a tool and a document.
 */
export function ProjectWorkspace({
  project,
  defaultCaptionStyle,
  initialClipId,
}: {
  project: ProjectDetail;
  defaultCaptionStyle: CaptionStyle;
  /** From `?clip=` — links from Overview and Library land on a specific clip. */
  initialClipId?: string;
}) {
  const router = useRouter();
  const player = useRef<PlayerHandle | null>(null);
  const [clips, setClips] = useState(project.clips);
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialClipId && project.clips.some((c) => c.id === initialClipId)
      ? initialClipId
      : project.clips[0]?.id) ?? null,
  );
  const [feed, setFeed] = useState<Feed>("source");
  const [panel, setPanel] = useState<Panel>("clips");
  const [time, setTime] = useState(0);

  const { source, sourceUrl, scenes } = project;
  const duration = source.duration_seconds ?? 0;

  const selected = useMemo(
    () => clips.find((c) => c.id === selectedId) ?? null,
    [clips, selectedId],
  );

  // Moments: the scored candidates the analyze pass recorded, plus any clip
  // that exists without a matching radar entry.
  const moments = useMemo<Moment[]>(() => {
    const fromClips: Moment[] = clips
      .filter((c) => c.status !== "rejected")
      .map((c) => ({
        start: Number(c.start_seconds),
        end: Number(c.end_seconds),
        score: c.score ?? c.peak_score ?? 0,
        label: c.category ?? "candidate",
        clipId: c.id,
        rank: c.rank,
      }));

    const covered = new Set(fromClips.map((m) => Math.round(m.start)));
    const fromRadar: Moment[] = (source.radar ?? [])
      .filter((entry) => !covered.has(Math.round(entry.start)))
      .map((entry) => ({
        start: entry.start,
        end: entry.end,
        score: entry.score,
        label: entry.label,
      }));

    return [...fromClips, ...fromRadar].sort((a, b) => a.start - b.start);
  }, [clips, source.radar]);

  const windows = useMemo(
    () =>
      clips
        .filter((c) => c.status !== "rejected")
        .map((c) => ({
          start: Number(c.start_seconds),
          end: Number(c.end_seconds),
          active: c.id === selectedId,
        })),
    [clips, selectedId],
  );

  const seek = useCallback((seconds: number) => {
    player.current?.seek(seconds);
    setTime(seconds);
  }, []);

  const selectClip = useCallback(
    (clip: ClipWithContext) => {
      setSelectedId(clip.id);
      // Only switch the monitor to the rendered clip if there is one; otherwise
      // stay on the source and put the playhead at the clip's opening frame.
      if (clip.previewUrl) setFeed("clip");
      else {
        setFeed("source");
        seek(Number(clip.start_seconds));
      }
    },
    [seek],
  );

  const onMoment = useCallback(
    (moment: Moment) => {
      const clip = moment.clipId ? clips.find((c) => c.id === moment.clipId) : null;
      if (clip) {
        setSelectedId(clip.id);
        setFeed("source");
      }
      seek(moment.start);
    },
    [clips, seek],
  );

  const patchClip = useCallback(
    (id: string, updated: Partial<ClipWithContext>) => {
      setClips((current) =>
        current.map((c) => (c.id === id ? { ...c, ...updated } : c)),
      );
      // Statuses moved by the worker (rendering → ready) only arrive on a
      // re-read, so pull the authoritative row after a mutation.
      router.refresh();
    },
    [router],
  );

  // Park the playhead on the deep-linked clip once the player can accept a
  // seek. Attempting it on mount races the element's metadata load.
  const jumped = useRef(false);
  const onPlayerReady = useCallback(() => {
    if (jumped.current || !initialClipId) return;
    const target = project.clips.find((c) => c.id === initialClipId);
    if (!target) return;
    jumped.current = true;
    player.current?.seek(Number(target.start_seconds));
    setTime(Number(target.start_seconds));
  }, [initialClipId, project.clips]);

  const showingClip = feed === "clip" && selected?.previewUrl;
  const scored = clips.filter((c) => c.score != null).length;
  const stages = sourceStages(
    source,
    clips.filter((c) =>
      ["ready_for_review", "queued", "uploaded"].includes(c.status),
    ).length,
    clips.filter((c) => c.status !== "rejected").length,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Project header ---------------------------------------------------- */}
      <div className="flex h-11 shrink-0 items-center gap-4 rule-b px-4">
        <h1 className="t-title min-w-0 truncate">
          {source.title ?? source.source_url}
        </h1>
        <span className="t-num shrink-0 text-xs text-fg-3">{hms(duration)}</span>
        <span className="shrink-0">
          <Status tone={statusTone(source.status)} label={statusLabel(source.status)} />
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          <span className="hidden items-baseline gap-4 lg:flex">
            <Figure value={moments.length} label="candidates" />
            <Figure value={clips.filter((c) => c.status !== "rejected").length} label="clips" />
            <Figure value={scenes.length} label="scenes" />
          </span>
          <Segmented
            size="sm"
            options={[
              { value: "source", label: "Source", hint: "The full episode" },
              {
                value: "clip",
                label: "Clip",
                hint: selected?.previewUrl
                  ? "The rendered vertical clip"
                  : "No render available for this clip yet",
              },
            ]}
            value={feed}
            onChange={(next) => setFeed(next as Feed)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Monitor + timelines -------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <VideoPlayer
            src={showingClip ? selected!.previewUrl : sourceUrl}
            vertical={Boolean(showingClip)}
            handleRef={player}
            label={showingClip ? "Rendered clip" : "Source video"}
            onTime={setTime}
            onReady={onPlayerReady}
            className="min-h-0 flex-1"
            timeline={
              showingClip && selected ? (
                <ClipTimeline clip={selected} playhead={time} onSeek={seek} />
              ) : (
                <SourceTimeline
                  source={source}
                  scenes={scenes}
                  windows={windows}
                  moments={moments}
                  playhead={time}
                  activeStart={selected ? Number(selected.start_seconds) : null}
                  onSeek={seek}
                  onMoment={onMoment}
                />
              )
            }
          />
        </div>

        {/* Clip panel ------------------------------------------------------ */}
        <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-line 2xl:w-[380px]">
          <Tabs
            items={[
              { value: "clips", label: "Clips", count: clips.length },
              { value: "pipeline", label: "Pipeline" },
            ]}
            value={panel}
            onChange={(next) => setPanel(next as Panel)}
          />

          {panel === "pipeline" ? (
            <div className="overflow-y-auto p-3">
              <ProcessingStages stages={stages} note={retryNotice(source)} />
              {source.error_message && (
                <p
                  role="alert"
                  className="mt-4 border-l-2 border-fg bg-s2 py-2 pl-3 text-xs leading-relaxed text-fg"
                >
                  {source.error_message}
                </p>
              )}
              <dl className="mt-5 space-y-2">
                <Row label="Source" value={source.source_url} mono />
                <Row label="Duration" value={hms(duration)} mono />
                <Row label="Scenes" value={String(scenes.length)} mono />
                <Row
                  label="Candidates"
                  value={String(source.analysis?.candidates_considered ?? 0)}
                  mono
                />
                <Row
                  label="Scored by model"
                  value={
                    source.analysis?.scored_by_model === false
                      ? "no — audio only"
                      : source.analysis?.scored_by_model
                        ? "yes"
                        : "not yet"
                  }
                />
              </dl>
            </div>
          ) : clips.length === 0 ? (
            <EmptyState
              title="No clips yet"
              body="Clips appear once the source has been analyzed and the ranked moments are cut."
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Clip list. Fixed max height so the inspector below always has
                  room — a long list must not push the decision off screen. */}
              <ul className="max-h-[38%] shrink-0 overflow-y-auto rule-b">
                {clips.map((clip) => {
                  const on = clip.id === selectedId;
                  const tier = band(clip.score ?? clip.peak_score ?? 0);
                  return (
                    <li key={clip.id}>
                      <button
                        type="button"
                        onClick={() => selectClip(clip)}
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
                          <span className="t-num block text-xs text-fg-2">
                            {hms(clip.start_seconds)}
                          </span>
                          <span className="t-label mt-0.5 block truncate">
                            {Math.round(clip.end_seconds - clip.start_seconds)}s
                            {clip.rank != null && ` · #${clip.rank}`}
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

              {selected && (
                <ClipInspector
                  clip={selected}
                  totalRanked={scored}
                  defaultCaptionStyle={defaultCaptionStyle}
                  onPatched={(updated) => patchClip(selected.id, updated)}
                  onSeek={(seconds) => {
                    setFeed("source");
                    seek(seconds);
                  }}
                />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The source timeline stack: energy, then candidates, on one shared scale. */
function SourceTimeline({
  source,
  scenes,
  windows,
  moments,
  playhead,
  activeStart,
  onSeek,
  onMoment,
}: {
  source: ProjectDetail["source"];
  scenes: number[];
  windows: Array<{ start: number; end: number; active?: boolean }>;
  moments: Moment[];
  playhead: number;
  activeStart: number | null;
  onSeek: (seconds: number) => void;
  onMoment: (moment: Moment) => void;
}) {
  return (
    <div className="space-y-2">
      <Waveform
        envelope={source.loudness_envelope}
        durationSeconds={source.duration_seconds}
        windows={windows}
        scenes={scenes}
        playhead={playhead}
        height={48}
        onSeek={onSeek}
      />
      <MomentMarkers
        moments={moments}
        durationSeconds={source.duration_seconds}
        activeStart={activeStart}
        onSelect={onMoment}
        height={44}
      />
      <TimeScale
        durationSeconds={source.duration_seconds}
        caption={`${scenes.length} scenes · click to seek`}
      />
    </div>
  );
}

/** The clip timeline stack: captions and the words themselves. */
function ClipTimeline({
  clip,
  playhead,
  onSeek,
}: {
  clip: ClipWithContext;
  playhead: number;
  onSeek: (seconds: number) => void;
}) {
  // The rendered clip starts at zero, so the player's clock has to be shifted
  // into source time before it can be compared with word timings.
  const absolute = Number(clip.start_seconds) + playhead;
  const words = clip.transcript?.words ?? [];

  return (
    <div className="space-y-2">
      <CaptionTrack
        words={words}
        clipStart={Number(clip.start_seconds)}
        clipEnd={Number(clip.end_seconds)}
        playhead={absolute}
        deadTime={clip.dead_time}
        onSeek={(seconds) => onSeek(seconds - Number(clip.start_seconds))}
        height={20}
      />
      <div className="flex items-baseline justify-between gap-4">
        <CaptionReadout
          words={words}
          clipStart={Number(clip.start_seconds)}
          clipEnd={Number(clip.end_seconds)}
          playhead={absolute}
          className="min-w-0 flex-1"
        />
        <span className="t-num shrink-0 text-2xs text-fg-4">{tc(playhead)}</span>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="t-num text-xs text-fg-2">
        {String(value).padStart(2, "0")}
      </span>
      <span className="t-label">{label}</span>
    </span>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-label shrink-0">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-xs text-fg-3",
          mono && "t-num",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
