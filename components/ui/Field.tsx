"use client";

import { forwardRef, useId } from "react";
import { cn } from "./cn";

const CONTROL =
  "w-full bg-s2 border border-line rounded text-fg placeholder:text-fg-4 " +
  "transition-colors duration-fast ease-ease " +
  "hover:border-line-strong focus:border-line-strong focus:outline-none " +
  "focus-visible:outline-1 focus-visible:outline-fg focus-visible:outline-offset-[-1px] " +
  "disabled:opacity-40 disabled:pointer-events-none";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function Input({ className, mono, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(CONTROL, "h-8 px-2.5 text-sm", mono && "t-num", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, "resize-y px-2.5 py-2 text-sm leading-relaxed", className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          CONTROL,
          "h-8 appearance-none pl-2.5 pr-7 text-sm",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {/* Drawn rather than iconised: a 4px chevron at this size is crisper as
          a rotated border than as an SVG stroke. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 block h-[5px] w-[5px] -translate-y-[3px] rotate-45 border-b border-r border-fg-3"
      />
    </div>
  );
});

/**
 * Label + control + hint, on the shared 4px rhythm.
 *
 * The hint sits under the control rather than under the label so the eye
 * reaches the input first; explanatory text is for the second pass.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="t-label block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-fg" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-fg-3">{hint}</p>
      )}
    </div>
  );
}

/**
 * A labelled row for settings: name and description on the left, control hard
 * right. Dense enough to stack a dozen without a scroll, which is the point.
 */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint && (
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-fg-3">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/**
 * A switch that reads as a physical two-position control: the track is a well,
 * the thumb is a plate, and the on state inverts. No colour change.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative block h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-fast ease-ease",
        checked ? "border-fg bg-fg" : "border-line-strong bg-s2 hover:bg-s3",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[2px] block h-[12px] w-[12px] rounded-full transition-all duration-fast ease-ease",
          checked ? "left-[17px] bg-bg" : "left-[2px] bg-fg-3",
        )}
      />
    </button>
  );
}
