"use client";

import { useCallback, useEffect, useState } from "react";
import { LoudnessRibbon } from "@/components/LoudnessRibbon";
import { StatusBadge } from "@/components/StatusBadge";
import { timecode } from "@/lib/format";
import type { CaptionStyle, ClipWithContext } from "@/lib/types";

interface Props {
  initial: ClipWithContext[];
  defaultCaptionStyle: CaptionStyle;
  uploadsRemaining: number;
  autoUpload: boolean;
}

export function ClipReview({
  initial,
  defaultCaptionStyle,
  uploadsRemaining,
  autoUpload,
}: Props) {
  const [clips, setClips] = useState(initial);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (res.ok) setClips(await res.json());
    } catch {
      /* next tick */
    }
  }, []);

  useEffect(() => {
    const working = clips.some((c) =>
      ["cropping", "transcribing", "rendering", "uploading"].includes(c.status),
    );
    const interval = setInterval(refresh, working ? 5000 : 25000);
    return () => clearInterval(interval);
  }, [clips, refresh]);

  async function patch(clipId: string, body: Record<string, unknown>) {
    setPending((p) => ({ ...p, [clipId]: true }));
    try {
      const res = await fetch(`/api/clips/${clipId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setClips((cs) => cs.map((c) => (c.id === clipId ? { ...c, ...updated } : c)));
      }
    } finally {
      setPending((p) => ({ ...p, [clipId]: false }));
    }
  }

  if (clips.length === 0) {
    return (
      <div className="panel px-6 py-20 text-center">
        <p className="text-sm text-dim">
          No clips yet. Add a source video on the Ingest page — clips appear
          here once the audio has been analyzed and cut.
        </p>
      </div>
    );
  }

  // Position in the upload queue determines whether the next cron run reaches
  // this clip. Showing that up front beats an unexplained wait.
  let queuePosition = 0;

  return (
    <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
      {clips.map((clip) => {
        const isQueued = clip.status === "queued";
        if (isQueued) queuePosition += 1;
        const willUploadNext = isQueued && queuePosition <= uploadsRemaining;
        const busy = pending[clip.id] === true;
        const selectedHook = clip.hooks.find((h) => h.is_selected);
        const needsStyle = clip.status === "ready_for_review" && !clip.caption_style;

        return (
          <article key={clip.id} className="panel flex flex-col">
            {/* Preview */}
            <div
              className="relative aspect-[9/16] max-h-[420px] w-full overflow-hidden rounded-t-[3px]"
              style={{ background: "var(--panel-2)" }}
            >
              {clip.previewUrl ? (
                <video
                  src={clip.previewUrl}
                  controls
                  preload="metadata"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="eyebrow">Rendering preview</span>
                </div>
              )}
              <span
                className="tc absolute left-2 top-2 rounded-[2px] px-2 py-1 text-[11px]"
                style={{ background: "rgba(11,15,20,.82)" }}
              >
                {timecode(clip.start_seconds)} → {timecode(clip.end_seconds)}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-4 p-4">
              <div className="flex items-center justify-between">
                <StatusBadge status={clip.status} />
                <span className="tc text-[11px] text-dim">
                  energy {clip.peak_score?.toFixed(2) ?? "--"}
                </span>
              </div>

              {/* Where this clip sits in the source's energy profile. */}
              <LoudnessRibbon
                envelope={clip.source?.loudness_envelope ?? null}
                durationSeconds={clip.source?.duration_seconds ?? null}
                windows={[
                  { start: clip.start_seconds, end: clip.end_seconds, active: true },
                ]}
                height={26}
              />

              {/* Caption style — required before the clip can proceed. */}
              <fieldset>
                <legend className="eyebrow mb-2">
                  Captions{needsStyle && " — pick one to continue"}
                </legend>
                <div className="flex gap-2">
                  {(["karaoke", "static"] as CaptionStyle[]).map((style) => {
                    const on = clip.caption_style === style;
                    return (
                      <button
                        key={style}
                        type="button"
                        disabled={busy || clip.status === "uploaded"}
                        onClick={() => patch(clip.id, { captionStyle: style })}
                        className="flex-1 rounded-[3px] border px-3 py-2 text-xs transition-colors disabled:opacity-40"
                        style={{
                          borderColor: on ? "var(--lamp)" : "var(--rule)",
                          color: on ? "var(--lamp)" : "var(--dim)",
                          background: on
                            ? "rgba(240,169,59,.08)"
                            : "transparent",
                        }}
                      >
                        {style === "karaoke" ? "Word by word" : "Full lines"}
                        {style === defaultCaptionStyle && (
                          <span className="ml-1 text-[10px] opacity-60">
                            default
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Hooks — violet marks everything the model wrote. */}
              {clip.hooks.length > 0 && (
                <fieldset>
                  <legend className="eyebrow mb-2" style={{ color: "var(--synth)" }}>
                    Description hook
                  </legend>
                  <div className="space-y-1.5">
                    {clip.hooks.map((hook) => {
                      const on = hook.is_selected;
                      return (
                        <button
                          key={hook.id}
                          type="button"
                          disabled={busy || clip.status === "uploaded"}
                          onClick={() => patch(clip.id, { hookId: hook.id })}
                          className="flex w-full gap-2 rounded-[3px] border p-2 text-left text-xs leading-snug transition-colors disabled:opacity-40"
                          style={{
                            borderColor: on ? "var(--synth)" : "var(--rule)",
                            background: on ? "rgba(158,123,255,.08)" : "transparent",
                          }}
                        >
                          <span
                            className="mt-[3px] block h-2 w-2 shrink-0 rounded-full border"
                            style={{
                              borderColor: on ? "var(--synth)" : "var(--rule)",
                              background: on ? "var(--synth)" : "transparent",
                            }}
                          />
                          <span style={{ color: on ? "var(--text)" : "var(--dim)" }}>
                            {hook.hook_text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <div className="mt-auto space-y-2 pt-2">
                {clip.status === "ready_for_review" && (
                  <button
                    type="button"
                    disabled={busy || !clip.caption_style || !selectedHook}
                    onClick={() => patch(clip.id, { status: "rendering" })}
                    className="w-full rounded-[3px] px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
                    style={{ background: "var(--lamp)", color: "var(--ink)" }}
                  >
                    {!clip.caption_style
                      ? "Pick a caption style first"
                      : !selectedHook
                        ? "Pick a hook first"
                        : "Approve for upload"}
                  </button>
                )}

                {isQueued && (
                  <p
                    className="eyebrow"
                    style={{
                      color: willUploadNext ? "var(--lamp)" : "var(--dim)",
                    }}
                  >
                    {willUploadNext
                      ? "uploads on next run"
                      : `waits for tomorrow's quota — #${queuePosition} in line`}
                  </p>
                )}

                {clip.status === "uploaded" && (
                  <p className="eyebrow" style={{ color: "var(--live)" }}>
                    published
                  </p>
                )}

                {clip.status === "failed" && clip.error_message && (
                  <p className="text-xs" style={{ color: "var(--peak)" }} role="alert">
                    {clip.error_message}
                  </p>
                )}

                {clip.status !== "uploaded" && clip.status !== "rejected" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch(clip.id, { status: "rejected" })}
                    className="w-full py-1 text-xs text-dim transition-colors hover:text-[color:var(--peak)] disabled:opacity-40"
                  >
                    Reject clip
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {!autoUpload && clips.some((c) => c.status === "queued") && (
        <p className="col-span-full text-xs text-dim">
          Auto-upload is off, so queued clips stay here. Turn it on in Settings
          to start publishing.
        </p>
      )}
    </div>
  );
}
