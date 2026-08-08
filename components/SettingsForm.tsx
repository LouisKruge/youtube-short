"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/types";

interface Props {
  settings: AppSettings;
  queuedCount: number;
}

export function SettingsForm({ settings: initial, queuedCount }: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingAutoUpload, setConfirmingAutoUpload] = useState(false);

  async function save(patch: Partial<AppSettings>) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setSettings(await res.json());
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleAutoUpload() {
    if (!settings.auto_upload_enabled && !confirmingAutoUpload) {
      // First time on: make the operator look at what is about to go out.
      setConfirmingAutoUpload(true);
      return;
    }
    setConfirmingAutoUpload(false);
    void save({ auto_upload_enabled: !settings.auto_upload_enabled });
  }

  return (
    <div className="space-y-5">
      {/* The gate. */}
      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-lg">
            <h2 className="display text-2xl">Auto-upload</h2>
            <p className="mt-2 text-sm leading-relaxed text-dim">
              While this is off, approved clips queue up and nothing reaches
              YouTube. Turn it on and every approved clip publishes on the next
              cron run, up to the daily quota, with no further approval.
            </p>
          </div>

          <button
            type="button"
            onClick={toggleAutoUpload}
            disabled={saving}
            role="switch"
            aria-checked={settings.auto_upload_enabled}
            className="relative h-9 w-16 shrink-0 rounded-full border transition-colors disabled:opacity-50"
            style={{
              background: settings.auto_upload_enabled
                ? "rgba(61,214,140,.18)"
                : "var(--panel-2)",
              borderColor: settings.auto_upload_enabled
                ? "var(--live)"
                : "var(--rule)",
            }}
          >
            <span className="sr-only">
              {settings.auto_upload_enabled ? "Turn auto-upload off" : "Turn auto-upload on"}
            </span>
            <span
              className="absolute top-1 block h-6 w-6 rounded-full transition-all"
              style={{
                left: settings.auto_upload_enabled ? "2.1rem" : "0.25rem",
                background: settings.auto_upload_enabled
                  ? "var(--live)"
                  : "var(--dim)",
              }}
            />
          </button>
        </div>

        {confirmingAutoUpload && (
          <div
            className="mt-5 rounded-[3px] border p-4"
            style={{ borderColor: "var(--lamp)", background: "rgba(240,169,59,.06)" }}
          >
            <p className="text-sm">
              {queuedCount > 0
                ? `${queuedCount} clip${queuedCount === 1 ? "" : "s"} will publish to your channel on the next cron run.`
                : "Approved clips will publish to your channel automatically from now on."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={toggleAutoUpload}
                className="rounded-[3px] px-4 py-2 text-sm font-medium"
                style={{ background: "var(--lamp)", color: "var(--ink)" }}
              >
                Turn on auto-upload
              </button>
              <button
                type="button"
                onClick={() => setConfirmingAutoUpload(false)}
                className="rounded-[3px] border px-4 py-2 text-sm text-dim"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Pipeline defaults. */}
      <section className="panel p-6">
        <h2 className="display text-2xl">Pipeline</h2>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow">Default caption style</span>
            <select
              value={settings.default_caption_style}
              onChange={(e) =>
                save({
                  default_caption_style: e.target.value as "karaoke" | "static",
                })
              }
              className="panel-inset mt-2 w-full px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            >
              <option value="karaoke">Word by word (karaoke)</option>
              <option value="static">Full lines (static)</option>
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">Clip length — seconds</span>
            <input
              type="number"
              min={10}
              max={60}
              value={settings.clip_length_seconds}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  clip_length_seconds: Number(e.target.value),
                })
              }
              onBlur={() =>
                save({ clip_length_seconds: settings.clip_length_seconds })
              }
              className="panel-inset tc mt-2 w-full px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            />
          </label>

          <label className="block">
            <span className="eyebrow">Max clips per source</span>
            <input
              type="number"
              min={1}
              max={40}
              value={settings.max_clips_per_source}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_clips_per_source: Number(e.target.value),
                })
              }
              onBlur={() =>
                save({ max_clips_per_source: settings.max_clips_per_source })
              }
              className="panel-inset tc mt-2 w-full px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            />
          </label>

          <label className="block">
            <span className="eyebrow">Upload visibility</span>
            <select
              value={settings.youtube_privacy_status}
              onChange={(e) =>
                save({
                  youtube_privacy_status: e.target
                    .value as AppSettings["youtube_privacy_status"],
                })
              }
              className="panel-inset mt-2 w-full px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>

          <label className="block sm:col-span-2">
            <span className="eyebrow">Daily quota ceiling — units</span>
            <input
              type="number"
              min={1600}
              step={1600}
              value={settings.daily_quota_limit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  daily_quota_limit: Number(e.target.value),
                })
              }
              onBlur={() => save({ daily_quota_limit: settings.daily_quota_limit })}
              className="panel-inset tc mt-2 w-full px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--panel-2)" }}
            />
            <span className="mt-2 block text-xs leading-relaxed text-dim">
              Google grants 10,000 units a day by default. Each upload costs
              1,600, so that is {Math.floor(settings.daily_quota_limit / 1600)}{" "}
              upload{Math.floor(settings.daily_quota_limit / 1600) === 1 ? "" : "s"}.
              Only raise this after Google approves a quota increase — setting a
              higher number here does not grant you one.
            </span>
          </label>
        </div>

        <p className="eyebrow mt-5" style={{ color: saved ? "var(--live)" : undefined }}>
          {saving ? "saving…" : saved ? "saved" : "changes save automatically"}
        </p>
      </section>
    </div>
  );
}
