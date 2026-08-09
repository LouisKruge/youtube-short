"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "./cn";

type ToastTone = "info" | "attention";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<{
  toast: (message: string, tone?: ToastTone) => void;
}>({ toast: () => {} });

/**
 * Feedback for actions whose result is not already visible on screen.
 *
 * Deliberately terse: `SAVED`, not "✨ Successfully saved!". Toasts sit
 * bottom-left, out of the way of the right-hand panels, and auto-dismiss in
 * three seconds. Anything that needs longer than a glance is not a toast — it
 * belongs in the panel it concerns.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-1.5"
      >
        {toasts.map((item) => (
          <ToastItem
            key={item.id}
            toast={item}
            onDone={() =>
              setToasts((current) => current.filter((t) => t.id !== item.id))
            }
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className={cn(
        "anim-enter flex items-center gap-2 rounded border bg-raised px-3 py-2",
        toast.tone === "attention" ? "border-fg" : "border-line-strong",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-[5px] w-[5px] shrink-0",
          toast.tone === "attention" ? "bg-fg" : "rounded-full bg-fg-3",
        )}
      />
      <span className="t-label text-fg">{toast.message}</span>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext).toast;
}

/**
 * An inline saved/saving marker for forms, so a settings panel does not need a
 * toast to confirm something the operator is looking directly at.
 */
export function SaveState({
  state,
}: {
  state: "idle" | "saving" | "saved" | "error";
}) {
  if (state === "idle") return null;

  const text =
    state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved";

  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "block h-[5px] w-[5px] shrink-0",
          state === "saving" && "anim-pulse rounded-full bg-fg-2",
          state === "saved" && "rounded-full bg-fg",
          state === "error" && "bg-fg",
        )}
      />
      <span
        className={cn("t-label", state === "saving" ? "text-fg-3" : "text-fg")}
        aria-live="polite"
      >
        {text}
      </span>
    </span>
  );
}
