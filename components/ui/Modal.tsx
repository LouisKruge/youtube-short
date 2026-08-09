"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";

/**
 * A modal is a panel on a scrim, positioned high in the viewport rather than
 * dead-centre — centred dialogs push their content into the lower half of a
 * 1440-tall screen where the eye isn't.
 *
 * Escape closes, the scrim closes, focus moves in on open and the page behind
 * stops scrolling. There is no entrance animation beyond opacity: a dialog that
 * springs is a dialog you wait for.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  width = 480,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  width?: number;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first control, or the panel itself if it holds none.
    const focusable = panel.current?.querySelector<HTMLElement>(
      "input, textarea, select, button, [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panel.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />

      <div
        ref={panel}
        tabIndex={-1}
        style={{ width }}
        className="surface anim-enter relative max-h-[76vh] w-full overflow-y-auto bg-s1 outline-none"
      >
        <div className="flex items-start justify-between gap-4 rule-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="t-title">{title}</h2>
            {description && (
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-3">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={13} strokeWidth={1.5} />
          </IconButton>
        </div>

        {children && <div className="px-4 py-4">{children}</div>}

        {footer && (
          <div className="flex items-center justify-end gap-2 rule-t bg-s2 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A confirmation step for actions that cannot be walked back. The destructive
 * button is still a quiet one — the dialog is the warning, so the button does
 * not need to shout as well.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "h-7 rounded border border-transparent px-3 text-sm text-fg-3",
              "transition-colors duration-fast ease-ease hover:bg-s3 hover:text-fg",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-7 rounded border border-fg bg-fg px-3 text-sm font-medium text-bg transition-colors duration-fast ease-ease hover:bg-white disabled:opacity-35"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-base leading-relaxed text-fg-2">{body}</p>
    </Modal>
  );
}
