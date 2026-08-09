import type { SourceVideo } from "@/lib/types";

export type StageState = "waiting" | "running" | "complete" | "failed" | "skipped";

export interface Stage {
  label: string;
  state: StageState;
  /** 0–1 when the stage can honestly report a fraction. */
  progress?: number;
  /** A figure the stage produced, shown right-aligned when complete. */
  detail?: string;
}

/**
 * The processing readout, derived from columns the worker actually writes.
 *
 * Every stage here corresponds to a real signal — a populated envelope, a scene
 * count, a transcript flag. Nothing is inferred from elapsed time, and there is
 * no stage for work the pipeline does not do: speaker diarization is absent
 * because `whisper-1` returns no speaker labels, and a row reading "SPEAKER
 * ANALYSIS 72%" would be an invented number.
 */
export function sourceStages(
  source: Pick<
    SourceVideo,
    | "status"
    | "storage_path"
    | "loudness_envelope"
    | "scene_count"
    | "analysis"
    | "duration_seconds"
  >,
  clipsReady = 0,
  clipsTotal = 0,
): Stage[] {
  const failed = source.status === "failed";
  const downloaded = Boolean(source.storage_path);
  const analyzing = source.status === "analyzing";
  const analyzed = source.status === "analyzed";

  const envelope = (source.loudness_envelope?.length ?? 0) > 0;
  const scenes = source.scene_count != null;
  const transcribed = source.analysis?.transcribed === true;
  const scored = source.analysis?.clips_selected != null;

  /** A stage runs when its predecessor is done and it has not produced output. */
  const step = (
    done: boolean,
    predecessorDone: boolean,
    detail?: string,
  ): StageState => {
    if (done) return "complete";
    if (failed) return predecessorDone ? "failed" : "waiting";
    return predecessorDone && (analyzing || analyzed) ? "running" : "waiting";
  };

  const stages: Stage[] = [
    {
      label: "Retrieve source",
      state: downloaded
        ? "complete"
        : failed
          ? "failed"
          : source.status === "downloading"
            ? "running"
            : "waiting",
      detail: downloaded ? "on disk" : undefined,
    },
    {
      label: "Audio envelope",
      state: step(envelope, downloaded),
      detail: envelope ? `${source.loudness_envelope!.length} samples` : undefined,
    },
    {
      label: "Scene detection",
      state: step(scenes, envelope),
      detail: scenes ? `${source.scene_count} scenes` : undefined,
    },
    {
      label: "Transcription",
      state: step(transcribed, scenes),
      detail: transcribed ? "word-level" : undefined,
    },
    {
      label: "Moment scoring",
      state: step(scored, transcribed),
      detail: scored
        ? `${source.analysis?.candidates_considered ?? 0} candidates`
        : undefined,
    },
  ];

  // The render row only appears once there is something to render — before
  // that, a "0 of 0" row is noise.
  if (clipsTotal > 0) {
    stages.push({
      label: "Cut and caption",
      state: clipsReady >= clipsTotal ? "complete" : "running",
      progress: clipsTotal > 0 ? clipsReady / clipsTotal : undefined,
      detail: `${clipsReady} of ${clipsTotal}`,
    });
  }

  return stages;
}

/**
 * Terse stage names for the dense views. Sentence case, no gerund padding —
 * the status column is scanned, not read.
 */
export const STATUS_LABEL: Record<string, string> = {
  pending_download: "Queued",
  downloading: "Downloading",
  downloaded: "Retrieved",
  analyzing: "Analyzing",
  analyzed: "Analyzed",
  pending_segment: "Queued",
  segmented: "Cut",
  cropping: "Cropping",
  transcribing: "Transcribing",
  ready_for_review: "Needs review",
  rendering: "Rendering",
  queued: "Queued to publish",
  uploading: "Uploading",
  uploaded: "Published",
  failed: "Failed",
  rejected: "Rejected",
};

const IN_FLIGHT = new Set([
  "downloading",
  "analyzing",
  "cropping",
  "transcribing",
  "rendering",
  "uploading",
]);

/** Maps a pipeline status onto the five-shape status vocabulary. */
export function statusTone(
  status: string,
): "idle" | "active" | "done" | "attention" | "dismissed" {
  if (status === "failed") return "attention";
  if (status === "ready_for_review") return "attention";
  if (status === "rejected") return "dismissed";
  if (status === "uploaded" || status === "analyzed") return "done";
  if (IN_FLIGHT.has(status)) return "active";
  return "idle";
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}
