"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, SettingRow, Switch } from "@/components/ui/Field";
import { ConfirmModal } from "@/components/ui/Modal";
import { Panel, PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Note } from "@/components/ui/Status";
import { Segmented } from "@/components/ui/Tabs";
import { SaveState } from "@/components/ui/Toast";
import type { AppSettings } from "@/lib/types";

type Save = "idle" | "saving" | "saved" | "error";

/**
 * Settings.
 *
 * Every control saves on change; there is no Save button, and the state marker
 * in the panel header is the only feedback needed. Numeric fields commit on blur
 * rather than per keystroke, so typing "30" does not write a 3 on the way.
 *
 * Auto-upload is the one control with a confirmation, because it is the only one
 * whose effect leaves this machine.
 */
export function SettingsForm({
  settings: initial,
  queuedCount,
}: {
  settings: AppSettings;
  queuedCount: number;
}) {
  const [settings, setSettings] = useState(initial);
  const [state, setState] = useState<Save>("idle");
  const [confirming, setConfirming] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (patch: Partial<AppSettings>) => {
    setState("saving");
    if (clearTimer.current) clearTimeout(clearTimer.current);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      setSettings(await res.json());
      setState("saved");
      clearTimer.current = setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
    }
  }, []);

  /** Local edit now, write on blur — for fields typed digit by digit. */
  function numberField(
    key: keyof AppSettings,
    props: { min: number; max?: number; step?: number },
  ) {
    // The width sits on a wrapper, not on the input: the control's own `w-full`
    // resolves against a shrink-to-fit parent, so a width class on the input
    // itself loses to the element's intrinsic size and every field ends up a
    // different length.
    return (
      <span className="block w-[104px]">
        <Input
          mono
          type="number"
          className="text-right"
          value={String(settings[key] ?? "")}
          min={props.min}
          max={props.max}
          step={props.step}
          onChange={(e) =>
            setSettings({ ...settings, [key]: Number(e.target.value) })
          }
          onBlur={() => save({ [key]: settings[key] } as Partial<AppSettings>)}
          aria-label={String(key).replace(/_/g, " ")}
        />
      </span>
    );
  }

  const uploadsAtCeiling = Math.floor(settings.daily_quota_limit / 1600);

  return (
    // A settings row is a label and its control. In a 1300px column they end
    // up a screen apart and stop reading as one thing, so the form keeps its own
    // measure regardless of how much room the shell has.
    <div className="max-w-[720px] space-y-5">
      {/* The gate --------------------------------------------------------- */}
      <Panel>
        <PanelHeader
          title="Auto-upload"
          actions={
            <span
              className={
                settings.auto_upload_enabled ? "t-label text-fg" : "t-label"
              }
            >
              {settings.auto_upload_enabled ? "armed" : "held"}
            </span>
          }
        />
        <div className="flex items-start justify-between gap-6 px-3 py-3">
          <p className="max-w-prose text-base leading-relaxed text-fg-2">
            While this is held, approved clips queue up and nothing reaches
            YouTube. Armed, every approved clip publishes on the next worker
            pass up to the daily quota, with no further approval.
          </p>
          <Switch
            checked={settings.auto_upload_enabled}
            label="Auto-upload"
            onChange={(next) => {
              // Only arming needs a confirmation. Disarming is always safe.
              if (next) setConfirming(true);
              else void save({ auto_upload_enabled: false });
            }}
          />
        </div>
      </Panel>

      {/* Selection -------------------------------------------------------- */}
      <Panel>
        <PanelHeader title="Selection" actions={<SaveState state={state} />} />

        <PanelSection>
          <div className="divide-y divide-line">
            <SettingRow
              label="Clips per source"
              hint="How many of the top-ranked moments to actually cut. Each one costs a Whisper pass and two encodes, so this is the main cost dial."
            >
              {numberField("shorts_per_source", { min: 1, max: 50 })}
            </SettingRow>

            <SettingRow
              label="Hard ceiling per source"
              hint="An upper bound the picker will not exceed even if it finds more good candidates."
            >
              {numberField("max_clips_per_source", { min: 1, max: 40 })}
            </SettingRow>

            <SettingRow
              label="Clip length"
              hint="Target seconds per clip. The picker snaps to nearby silences, so the real length varies by a second or two."
            >
              {numberField("clip_length_seconds", { min: 10, max: 60 })}
            </SettingRow>
          </div>
        </PanelSection>
      </Panel>

      {/* Rendering -------------------------------------------------------- */}
      <Panel>
        <PanelHeader title="Rendering" actions={<SaveState state={state} />} />

        <PanelSection>
          <div className="divide-y divide-line">
            <SettingRow
              label="Default caption timing"
              hint="Applied to new clips. Any clip can be switched individually before approval."
            >
              <Segmented
                size="sm"
                options={[
                  { value: "karaoke", label: "Word" },
                  { value: "static", label: "Line" },
                ]}
                value={settings.default_caption_style}
                onChange={(next) =>
                  save({
                    default_caption_style:
                      next as AppSettings["default_caption_style"],
                  })
                }
              />
            </SettingRow>

            <SettingRow label="Default caption look">
              <Select
                className="w-[184px]"
                value={settings.default_caption_preset}
                onChange={(e) =>
                  save({
                    default_caption_preset: e.target
                      .value as AppSettings["default_caption_preset"],
                  })
                }
                aria-label="Default caption look"
              >
                <option value="clean">Clean — neutral, thin outline</option>
                <option value="punch">Punch — heavy, high contrast</option>
                <option value="cinematic">Cinematic — wide, lower third</option>
                <option value="minimal">Minimal — small, unboxed</option>
              </Select>
            </SettingRow>

            <SettingRow
              label="Follow motion when cropping"
              hint="Pans the 9:16 window toward whatever moves most. This is motion tracking, not face tracking — on a locked-off shot with a busy background it can be pulled off the subject. Off means a fixed centre crop."
            >
              <Switch
                checked={settings.smart_crop}
                label="Follow motion when cropping"
                onChange={(next) => save({ smart_crop: next })}
              />
            </SettingRow>

            <SettingRow
              label="Trim silence and frozen frames"
              hint="Cuts held pauses and static frames out of each clip. Never touches the first second, since that is the hook."
            >
              <Switch
                checked={settings.remove_dead_time}
                label="Trim silence and frozen frames"
                onChange={(next) => save({ remove_dead_time: next })}
              />
            </SettingRow>
          </div>
        </PanelSection>
      </Panel>

      {/* Publishing ------------------------------------------------------- */}
      <Panel>
        <PanelHeader title="Publishing" actions={<SaveState state={state} />} />

        <PanelSection>
          <div className="divide-y divide-line">
            <SettingRow
              label="Upload visibility"
              hint="Keeping an upload private does not by itself grant you redistribution rights for the source material."
            >
              <Segmented
                size="sm"
                options={[
                  { value: "public", label: "Public" },
                  { value: "unlisted", label: "Unlisted" },
                  { value: "private", label: "Private" },
                ]}
                value={settings.youtube_privacy_status}
                onChange={(next) =>
                  save({
                    youtube_privacy_status:
                      next as AppSettings["youtube_privacy_status"],
                  })
                }
              />
            </SettingRow>

            <SettingRow
              label="Daily quota ceiling"
              hint={`Units. Google grants 10,000 a day by default and each upload costs 1,600 — so this ceiling allows ${uploadsAtCeiling} upload${uploadsAtCeiling === 1 ? "" : "s"}. Only raise it after Google approves an increase; a bigger number here does not grant you one.`}
            >
              {numberField("daily_quota_limit", { min: 1600, step: 1600 })}
            </SettingRow>
          </div>
        </PanelSection>
      </Panel>

      <Note>
        Changes save as you make them. The worker reads these on its next pass,
        so a clip already mid-render keeps the settings it started with.
      </Note>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void save({ auto_upload_enabled: true });
        }}
        title="Arm auto-upload"
        confirmLabel="Arm auto-upload"
        body={
          queuedCount > 0
            ? `${queuedCount} approved clip${queuedCount === 1 ? "" : "s"} will publish to your channel on the next worker pass, and every clip you approve after that will follow automatically.`
            : "Every clip you approve from now on will publish to your channel automatically, without a further prompt."
        }
      />
    </div>
  );
}

/** A small helper the settings page uses for the connect/disconnect actions. */
export function ConnectAction({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button
      variant="primary"
      size="md"
      onClick={() => (window.location.href = href)}
    >
      {label}
    </Button>
  );
}
