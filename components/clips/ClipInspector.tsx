"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { CheckMark } from "@/components/ui/DataTable";
import { PanelSection } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Tabs";
import { Alert, Status } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { ClipAnalysis } from "./ClipAnalysis";
import { CropTrackChart, type CropTrackData } from "./CropTrack";
import { hms } from "./Waveform";
import { tc } from "./VideoPlayer";
import { statusLabel, statusTone } from "@/lib/stages";
import {
  CAPTION_PRESETS,
  type CaptionPreset,
  type CaptionStyle,
  type ClipWithContext,
} from "@/lib/types";

const STYLE_OPTIONS: Array<{ value: CaptionStyle; label: string; hint: string }> = [
  {
    value: "karaoke",
    label: "Word",
    hint: "Each word lights as it is spoken",
  },
  {
    value: "static",
    label: "Line",
    hint: "Whole lines held on screen",
  },
];

const PRESET_HINTS: Record<CaptionPreset, string> = {
  clean: "Neutral sans, thin outline",
  punch: "Heavy, tight, high contrast",
  cinematic: "Wide tracking, lower third",
  minimal: "Small, unboxed, low weight",
};

/**
 * The inspector: everything the operator can decide about one clip.
 *
 * Ordered by what blocks progress. A clip cannot be approved without a caption
 * style and a hook, so those come first and the approve button states which one
 * is missing rather than sitting there disabled and silent.
 */
export function ClipInspector({
  clip,
  totalRanked,
  defaultCaptionStyle,
  onPatched,
  onSeek,
}: {
  clip: ClipWithContext;
  totalRanked?: number;
  defaultCaptionStyle: CaptionStyle;
  onPatched: (updated: Partial<ClipWithContext>) => void;
  /** Seek the player, in absolute source seconds. */
  onSeek?: (seconds: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const selectedHook = clip.hooks.find((h) => h.is_selected && h.kind === "hook");
  const hooks = clip.hooks.filter((h) => h.kind === "hook");
  const locked = clip.status === "uploaded" || clip.status === "rejected";
  const deadSeconds = clip.dead_time.reduce((a, d) => a + (d.end - d.start), 0);

  async function patch(body: Record<string, unknown>, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "That did not go through.");
      onPatched(payload);
      if (note) toast(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Identity ---------------------------------------------------------- */}
      <div className="flex items-start justify-between gap-3 rule-b px-3 py-2.5">
        <div className="min-w-0">
          <p className="t-num text-xs text-fg">
            {tc(clip.start_seconds)}
            <span className="text-fg-4"> → </span>
            {tc(clip.end_seconds)}
          </p>
          <p className="t-label mt-1">
            {Math.round(clip.end_seconds - clip.start_seconds)}s
            {deadSeconds > 0.2 && ` · ${deadSeconds.toFixed(1)}s trimmed`}
          </p>
        </div>
        <Status tone={statusTone(clip.status)} label={statusLabel(clip.status)} />
      </div>

      {/* Score ------------------------------------------------------------- */}
      <PanelSection>
        <ClipAnalysis
          score={clip.score}
          factors={clip.score_factors}
          rationale={clip.rationale}
          category={clip.category}
          rank={clip.rank}
          totalRanked={totalRanked}
        />
      </PanelSection>

      {/* Hook restructure -------------------------------------------------- */}
      {clip.hook_analysis?.suggestion && !clip.hook_analysis.applied && (
        <PanelSection label="Stronger opening found">
          <p className="text-sm leading-relaxed text-fg-2">
            {clip.hook_analysis.suggestion}
          </p>
          {clip.hook_analysis.line && (
            <button
              type="button"
              onClick={() =>
                onSeek?.(
                  clip.start_seconds + (clip.hook_analysis?.best_opening_at ?? 0),
                )
              }
              className="mt-2 block w-full text-left text-sm italic text-fg-3 transition-colors duration-fast hover:text-fg-2"
            >
              &ldquo;{clip.hook_analysis.line}&rdquo;
            </button>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              disabled={busy || locked}
              onClick={() =>
                patch({ applyHook: true }, "Recutting from the stronger open")
              }
            >
              Restructure and re-cut
            </Button>
            <span className="t-num text-2xs text-fg-4">
              +{clip.hook_analysis.best_opening_at.toFixed(1)}s
            </span>
          </div>
        </PanelSection>
      )}

      {/* Framing ----------------------------------------------------------- */}
      <PanelSection label="Framing · follows motion, not faces">
        <CropTrackChart
          track={clip.crop_track as CropTrackData | null}
          durationSeconds={Math.max(1, clip.end_seconds - clip.start_seconds)}
        />
      </PanelSection>

      {/* Captions ---------------------------------------------------------- */}
      <PanelSection label="Captions">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="t-label">timing</span>
            <Segmented
              size="sm"
              options={STYLE_OPTIONS.map((o) => ({
                ...o,
                label:
                  o.value === defaultCaptionStyle ? `${o.label} ·` : o.label,
                hint:
                  o.value === defaultCaptionStyle
                    ? `${o.hint} (your default)`
                    : o.hint,
              }))}
              value={clip.caption_style}
              onChange={(style) =>
                patch({ captionStyle: style }, `Captions set to ${style}`)
              }
              disabled={busy || locked}
            />
          </div>

          <div className="flex items-start justify-between gap-3">
            <span className="t-label pt-1">look</span>
            <div className="flex flex-wrap justify-end gap-1">
              {CAPTION_PRESETS.map((preset: CaptionPreset) => {
                const on = clip.caption_preset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    title={PRESET_HINTS[preset]}
                    disabled={busy || locked}
                    onClick={() =>
                      patch({ captionPreset: preset }, `Preset ${preset}`)
                    }
                    className={cn(
                      "h-6 rounded px-2 text-xs transition-colors duration-fast ease-ease disabled:opacity-40",
                      on
                        ? "bg-s3 text-fg"
                        : "text-fg-3 hover:bg-s2 hover:text-fg-2",
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PanelSection>

      {/* Hooks ------------------------------------------------------------- */}
      {hooks.length > 0 && (
        <PanelSection label="Description hook">
          <ul className="space-y-px">
            {hooks.map((hook) => {
              const on = hook.is_selected;
              return (
                <li key={hook.id}>
                  <button
                    type="button"
                    disabled={busy || locked}
                    onClick={() => patch({ hookId: hook.id }, "Hook selected")}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left transition-colors duration-fast ease-ease disabled:opacity-40",
                      on ? "bg-s3" : "hover:bg-s2",
                    )}
                  >
                    <span className="mt-[3px] shrink-0">
                      <CheckMark checked={on} />
                    </span>
                    <span
                      className={cn(
                        "text-sm leading-snug",
                        on ? "text-fg" : "text-fg-3",
                      )}
                    >
                      {hook.hook_text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}

      {/* Metadata ---------------------------------------------------------- */}
      {(clip.title || clip.description) && (
        <PanelSection label="Publishing metadata">
          {clip.title && <p className="text-sm text-fg">{clip.title}</p>}
          {clip.description && (
            <p className="mt-1.5 text-xs leading-relaxed text-fg-3">
              {clip.description}
            </p>
          )}
          {clip.hashtags && clip.hashtags.length > 0 && (
            <p className="t-num mt-2 text-2xs text-fg-4">
              {clip.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
            </p>
          )}
        </PanelSection>
      )}

      {/* Actions ----------------------------------------------------------- */}
      <div className="mt-auto space-y-2 rule-t bg-s2 p-3">
        {error && <Alert>{error}</Alert>}

        {clip.status === "failed" && clip.error_message && (
          <Alert>{clip.error_message}</Alert>
        )}

        {clip.status === "ready_for_review" && (
          <Button
            variant="primary"
            block
            disabled={busy || !clip.caption_style || !selectedHook}
            onClick={() => patch({ status: "rendering" }, "Approved")}
          >
            {!clip.caption_style
              ? "Pick a caption timing first"
              : !selectedHook
                ? "Pick a hook first"
                : "Approve for upload"}
          </Button>
        )}

        {clip.status === "queued" && (
          <p className="t-label text-fg-2">
            waiting on quota · publishes on the next worker pass
          </p>
        )}

        {clip.status === "uploaded" && (
          <p className="t-label text-fg">published</p>
        )}

        {!locked && (
          <Button
            variant="danger"
            block
            size="sm"
            disabled={busy}
            onClick={() => patch({ status: "rejected" }, "Rejected")}
          >
            Reject clip
          </Button>
        )}

        <p className="t-num text-2xs text-fg-4">
          window {hms(clip.start_seconds)} – {hms(clip.end_seconds)}
        </p>
      </div>
    </div>
  );
}
