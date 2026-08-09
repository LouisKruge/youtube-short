"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { createClient } from "@/lib/supabase/client";

/**
 * The operator menu. A 22px plate with the account initial — an avatar image
 * would be the only photographic element in the chrome, and there is exactly
 * one operator, so a letter carries the same information.
 */
export function ProfileMenu({
  email,
  autoUpload,
}: {
  email: string | null;
  autoUpload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  const initial = (email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className={cn(
          "ml-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border text-2xs font-medium transition-colors duration-fast ease-ease",
          open
            ? "border-fg bg-fg text-bg"
            : "border-line-strong bg-s2 text-fg-2 hover:border-fg-3 hover:text-fg",
        )}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="surface anim-enter absolute right-0 top-[30px] w-[236px] overflow-hidden bg-s1"
        >
          <div className="rule-b px-3 py-2.5">
            <p className="t-label">signed in as</p>
            <p className="mt-1 truncate text-sm text-fg">{email ?? "unknown"}</p>
          </div>

          <div className="flex items-center justify-between gap-3 rule-b px-3 py-2.5">
            <span className="t-label">auto-upload</span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "block h-[5px] w-[5px] shrink-0 rounded-full",
                  autoUpload ? "bg-fg" : "border border-fg-4",
                )}
              />
              <span className={cn("t-label", autoUpload ? "text-fg" : "text-fg-3")}>
                {autoUpload ? "on" : "off"}
              </span>
            </span>
          </div>

          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-fg-2 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg"
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-fg-2 transition-colors duration-fast ease-ease hover:bg-s2 hover:text-fg"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
