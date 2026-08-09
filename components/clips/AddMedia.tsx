"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/Meter";
import { Alert, Note } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_BUCKET } from "@/lib/media";

type Mode = "file" | "url";

interface Transfer {
  name: string;
  /** 0–1, or null while the browser has not reported progress yet. */
  progress: number | null;
  state: "uploading" | "done" | "failed";
  error?: string;
}

const ACCEPT = ".mp4,.mov,.mkv,.m4v,.webm";

/**
 * Ingest.
 *
 * Two ways in, and they are genuinely different operations rather than two
 * skins on the same field: a local file goes straight to Storage from the
 * browser, a URL is fetched by the worker with yt-dlp. The tab is the honest
 * place to put that distinction.
 *
 * The drop target is a dashed hairline that goes solid while a file is over it.
 * No illustration, no cloud icon, no gradient — the whole affordance is the
 * word DROP and a rectangle.
 */
export function AddMedia({
  shortsPerSource,
  onAdded,
}: {
  shortsPerSource: number;
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<Mode>("file");
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Nested dragenter/dragleave events fire per child element; counting them is
  // the only reliable way to know the pointer has actually left the target.
  const dragDepth = useRef(0);
  const toast = useToast();

  const urlCount = urls
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0).length;

  /** Reads duration from the file locally so the queue shows a length at once. */
  const probeDuration = useCallback((file: File): Promise<number | null> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const el = document.createElement("video");
      const done = (value: number | null) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      el.preload = "metadata";
      el.onloadedmetadata = () =>
        done(Number.isFinite(el.duration) ? el.duration : null);
      el.onerror = () => done(null);
      el.src = url;
      // A container the browser cannot parse is still fine for ffmpeg, so give
      // up on the probe rather than on the upload.
      setTimeout(() => done(null), 5000);
    });
  }, []);

  const uploadOne = useCallback(
    async (file: File, index: number) => {
      const setTransfer = (patch: Partial<Transfer>) =>
        setTransfers((current) =>
          current.map((t, i) => (i === index ? { ...t, ...patch } : t)),
        );

      try {
        const durationSeconds = await probeDuration(file);

        const openRes = await fetch("/api/sources/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            sizeBytes: file.size,
            durationSeconds,
          }),
        });
        const opened = await openRes.json();
        if (!openRes.ok) throw new Error(opened.error ?? "Could not start the upload.");

        // uploadToSignedUrl does not expose progress, so the transfer shows an
        // indeterminate state until it resolves. Better than a fake percentage.
        setTransfer({ progress: null });

        const supabase = createClient();
        const { error: putError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .uploadToSignedUrl(opened.path, opened.token, file, {
            contentType: file.type || "video/mp4",
          });
        if (putError) throw new Error(putError.message);

        const doneRes = await fetch("/api/sources/upload", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: opened.sourceId, durationSeconds }),
        });
        const finished = await doneRes.json();
        if (!doneRes.ok) throw new Error(finished.error ?? "The upload did not land.");

        setTransfer({ state: "done", progress: 1 });
      } catch (err) {
        setTransfer({
          state: "failed",
          error: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    },
    [probeDuration],
  );

  const takeFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);

      const offset = transfers.length;
      setTransfers((current) => [
        ...current,
        ...files.map((file) => ({
          name: file.name,
          progress: 0 as number | null,
          state: "uploading" as const,
        })),
      ]);

      setBusy(true);
      // Sequential: parallel multi-gigabyte uploads just split the same pipe and
      // make every one of them slower.
      for (let i = 0; i < files.length; i++) {
        await uploadOne(files[i], offset + i);
      }
      setBusy(false);
      toast(files.length === 1 ? "Media added" : `${files.length} added`);
      onAdded();
    },
    [transfers.length, uploadOne, onAdded, toast],
  );

  async function submitUrls(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sourceUrls = urls
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
            .map((r: { input: string; reason: string }) => `${r.input} — ${r.reason}`)
            .join("; ")}`,
        );
      }
      setUrls("");
      toast(
        payload.created?.length === 1
          ? "Media queued"
          : `${payload.created?.length ?? 0} queued`,
      );
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Tabs
        items={[
          { value: "file", label: "Local file" },
          { value: "url", label: "From URL" },
        ]}
        value={mode}
        onChange={setMode}
        className="mb-4"
      />

      {mode === "file" ? (
        <>
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              void takeFiles(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded border border-dashed px-6 py-12 text-center transition-colors duration-fast ease-ease",
              dragging
                ? "border-fg border-solid bg-s2"
                : "border-line-strong bg-transparent",
            )}
          >
            <p className="t-label text-fg-2">
              {dragging ? "release to add" : "drop media"}
            </p>
            <p className="text-xs text-fg-4">or</p>
            <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
              Select files
            </Button>
            <p className="t-label mt-1">mp4 · mov · mkv · m4v · webm</p>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                void takeFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {transfers.length > 0 && (
            <ul className="mt-4 space-y-0">
              {transfers.map((transfer, i) => (
                <li
                  key={`${transfer.name}-${i}`}
                  className="flex items-center gap-3 rule-b py-2 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-[5px] w-[5px] shrink-0",
                      transfer.state === "uploading" &&
                        "anim-pulse rounded-full bg-fg-2",
                      transfer.state === "done" && "rounded-full bg-fg",
                      transfer.state === "failed" && "bg-fg",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-2">
                    {transfer.name}
                  </span>
                  {transfer.state === "uploading" && (
                    <span className="w-24 shrink-0">
                      <ProgressBar value={transfer.progress ?? 0.04} max={1} />
                    </span>
                  )}
                  <span className="t-label w-[64px] shrink-0 text-right">
                    {transfer.state === "uploading"
                      ? "sending"
                      : transfer.state === "done"
                        ? "queued"
                        : "failed"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {transfers.some((t) => t.state === "failed") && (
            <Alert className="mt-3">
              {transfers.find((t) => t.state === "failed")?.error}
            </Alert>
          )}
        </>
      ) : (
        <form onSubmit={submitUrls}>
          <Textarea
            rows={3}
            required
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"https://…\nhttps://…"}
            aria-label="Source video URLs, one per line"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || urlCount === 0}
            >
              {busy
                ? "Queueing…"
                : `Analyze ${urlCount <= 1 ? "source" : `${urlCount} sources`}`}
            </Button>
            <span className="t-label">
              one per line · up to {shortsPerSource} clips each
            </span>
          </div>
        </form>
      )}

      {error && <Alert className="mt-3">{error}</Alert>}

      <Note className="mt-4">
        You are responsible for having the rights to whatever you put in here,
        and for anything you publish from it. Nexus does not check that for you.
      </Note>
    </div>
  );
}
