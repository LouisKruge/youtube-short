"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipRadar } from "@/components/ClipRadar";
import { LoudnessRibbon } from "@/components/LoudnessRibbon";
import { StatusBadge } from "@/components/StatusBadge";
import { duration, relativeTime } from "@/lib/format";
import type { SourceVideo } from "@/lib/types";

interface SourceRow extends SourceVideo {
  clipCount: number;
  windows: { start: number; end: number }[];
}

export function IngestPanel({
  initial,
  shortsPerSource = 10,
}: {
  initial: SourceRow[];
  shortsPerSource?: number;
}) {
  const [sources, setSources] = useState(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineCount = Math.max(
    1,
    url.split(/[\n,]/).filter((u) => u.trim().length > 0).length,
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (res.ok) setSources(await res.json());
    } catch {
      // Transient network blip; the next tick will pick it up.
    }
  }, []);

  // Poll while anything is mid-pipeline; idle otherwise.
  useEffect(() => {
    const working = sources.some((s) =>
      ["pending_download", "downloading", "downloaded", "analyzing"].includes(
        s.status,
      ),
    );
    const interval = setInterval(refresh, working ? 4000 : 20000);
    return () => clearInterval(interval);
  }, [sources, refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sourceUrls = url
        .split(/[\n,]/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrls }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not add those URLs.");

      if (payload.rejected?.length > 0) {
        setError(
          `Skipped ${payload.rejected.length}: ${payload.rejected
            .map((r: { input: string; reason: string }) => `${r.input} (${r.reason})`)
            .join(", ")}`,
        );
      }
      setUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <form onSubmit={submit} className="panel p-5">
        <label htmlFor="source-url" className="eyebrow">
          Source video URLs — one per line
        </label>
        <textarea
          id="source-url"
          required
          rows={3}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={"https://…\nhttps://…"}
          className="panel-inset mt-3 w-full resize-y px-4 py-3 text-sm outline-none placeholder:text-dim"
          style={{ background: "var(--panel-2)" }}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || url.trim().length === 0}
            className="rounded-[3px] px-6 py-3 text-sm font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--lamp)", color: "var(--ink)" }}
          >
            {busy ? "Adding…" : `Analyze ${lineCount === 1 ? "video" : `${lineCount} videos`}`}
          </button>
          <span className="eyebrow">
            each yields up to {shortsPerSource} ranked shorts
          </span>
        </div>
        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--peak)" }} role="alert">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-dim">
          You are responsible for having the rights to republish whatever you
          put in here. Nexus Clips does not check that for you.
        </p>
      </form>

      <section>
        <h2 className="eyebrow mb-4">Queue</h2>

        {sources.length === 0 ? (
          <div className="panel px-6 py-16 text-center">
            <p className="text-sm text-dim">
              Nothing queued. Paste a video URL above to cut your first clips.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sources.map((source) => (
              <li key={source.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {source.title ?? source.source_url}
                    </p>
                    <p className="tc mt-1 truncate text-xs text-dim">
                      {source.source_url}
                    </p>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="tc text-xs text-dim">
                      {duration(source.duration_seconds)}
                    </span>
                    <span className="tc text-xs text-dim">
                      {source.clipCount} clip{source.clipCount === 1 ? "" : "s"}
                    </span>
                    <StatusBadge status={source.status} />
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <LoudnessRibbon
                    envelope={source.loudness_envelope}
                    durationSeconds={source.duration_seconds}
                    windows={source.windows}
                    showScale
                  />

                  {(source.radar ?? []).length > 0 && (
                    <ClipRadar
                      entries={source.radar}
                      durationSeconds={source.duration_seconds}
                      live={source.status === "analyzing"}
                    />
                  )}

                  {source.analysis && (
                    <p className="eyebrow">
                      {source.scene_count ?? 0} scenes ·{" "}
                      {source.analysis.candidates_considered ?? 0} candidates
                      considered · {source.analysis.clips_selected ?? 0} kept
                      {source.analysis.scored_by_model === false &&
                        " · ranked on audio only"}
                    </p>
                  )}
                </div>

                {source.error_message && (
                  <p
                    className="mt-3 text-xs"
                    style={{ color: "var(--peak)" }}
                    role="alert"
                  >
                    {source.error_message}
                  </p>
                )}

                <p className="eyebrow mt-3">
                  added {relativeTime(source.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
