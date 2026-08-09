"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Kbd } from "@/components/ui/Tooltip";
import { ALL_NAV } from "./nav";

interface Entry {
  id: string;
  /** Group heading. Ordering of groups is fixed by GROUP_ORDER. */
  group: "Go to" | "Projects" | "Said in a source" | "Actions";
  label: string;
  detail?: string;
  /** Pre-rendered highlight fragment from Postgres ts_headline. */
  headline?: string;
  run: () => void;
}

const GROUP_ORDER: Entry["group"][] = [
  "Go to",
  "Projects",
  "Said in a source",
  "Actions",
];

interface SourceHit {
  id: string;
  title: string | null;
  source_url: string;
  status: string;
}

interface TranscriptHit {
  source_video_id: string;
  source_title: string | null;
  headline: string;
}

/**
 * Command palette.
 *
 * Doubles as the search field, because in this product they are the same
 * question: the operator wants to get to a project, or to the moment where
 * someone said a particular thing. Typing two characters starts a transcript
 * search across every source ever ingested and lists the projects it hit —
 * so "what are you doing" is a navigation query, not a separate feature.
 */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [sources, setSources] = useState<SourceHit[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptHit[]>([]);
  const [searching, setSearching] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  // Project list is small and cached by the route handler; fetch once per open
  // so titles are current without a request per keystroke.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/sources", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SourceHit[]) => {
        if (live) setSources(rows.slice(0, 40));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  // Transcript search is debounced — it is a full-text query over every
  // transcript, not something to run on every keystroke.
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) {
      setTranscripts([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: TranscriptHit[]) => setTranscripts(rows.slice(0, 6)))
        .catch(() => setTranscripts([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const term = query.trim().toLowerCase();
    const out: Entry[] = [];

    for (const item of ALL_NAV) {
      if (term && !item.label.toLowerCase().includes(term)) continue;
      out.push({
        id: `nav:${item.href}`,
        group: "Go to",
        label: item.label,
        run: () => go(item.href),
      });
    }

    for (const source of sources) {
      const name = source.title ?? source.source_url;
      if (term && !name.toLowerCase().includes(term)) continue;
      out.push({
        id: `src:${source.id}`,
        group: "Projects",
        label: name,
        detail: source.status.replace(/_/g, " "),
        run: () => go(`/projects/${source.id}`),
      });
      if (out.filter((e) => e.group === "Projects").length >= 6) break;
    }

    for (const hit of transcripts) {
      out.push({
        id: `t:${hit.source_video_id}`,
        group: "Said in a source",
        label: hit.source_title ?? "Untitled source",
        headline: hit.headline,
        run: () => go(`/projects/${hit.source_video_id}`),
      });
    }

    const actions: Array<{ label: string; href: string }> = [
      { label: "Add media", href: "/projects?add=1" },
      { label: "Connect YouTube channel", href: "/settings" },
      { label: "Review the upload queue", href: "/queue" },
    ];
    for (const action of actions) {
      if (term && !action.label.toLowerCase().includes(term)) continue;
      out.push({
        id: `act:${action.href}${action.label}`,
        group: "Actions",
        label: action.label,
        run: () => go(action.href),
      });
    }

    return out.sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  }, [query, sources, transcripts, go]);

  // Clamp rather than reset, so refining a query keeps the cursor near where
  // the operator left it.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(entries.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        entries[cursor]?.run();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, entries, cursor, onClose]);

  // Keep the cursor in view during keyboard travel.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />

      <div className="surface anim-enter relative flex w-full max-w-[560px] flex-col overflow-hidden bg-s1">
        <div className="flex h-9 items-center gap-2.5 rule-b px-3">
          <Search size={13} strokeWidth={1.5} className="shrink-0 text-fg-4" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the palette
              exists to receive typing; opening it without focus is a dead end. */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a project, or search everything anyone said"
            aria-label="Search"
            className="h-full flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-4"
          />
          {searching && (
            <span className="t-label shrink-0 text-fg-4">searching</span>
          )}
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-sm text-fg-3">
              Nothing matched. Only sources that finished transcribing are
              searchable by speech.
            </p>
          ) : (
            entries.map((entry, i) => {
              const showGroup = entry.group !== lastGroup;
              lastGroup = entry.group;
              const active = i === cursor;

              return (
                <div key={entry.id}>
                  {showGroup && (
                    <p className="t-label px-3 pb-1 pt-2.5">{entry.group}</p>
                  )}
                  <button
                    type="button"
                    data-cursor={active}
                    onMouseEnter={() => setCursor(i)}
                    onClick={entry.run}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-fast ease-ease",
                      active ? "bg-s3" : "hover:bg-s2",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          active ? "text-fg" : "text-fg-2",
                        )}
                      >
                        {entry.label}
                      </span>
                      {entry.headline && (
                        // ts_headline wraps matches in <b>. Generated by
                        // Postgres from our own transcript column.
                        <span
                          className="mt-0.5 block truncate text-xs text-fg-3 [&_b]:font-normal [&_b]:text-fg"
                          dangerouslySetInnerHTML={{ __html: entry.headline }}
                        />
                      )}
                      {entry.detail && (
                        <span className="t-label mt-0.5 block truncate">
                          {entry.detail}
                        </span>
                      )}
                    </span>
                    {active && (
                      <CornerDownLeft
                        size={12}
                        strokeWidth={1.5}
                        className="shrink-0 text-fg-4"
                      />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 rule-t bg-s2 px-3 py-2">
          <Hint keys={["↑", "↓"]} label="Move" />
          <Hint keys={["↵"]} label="Open" />
          <Hint keys={["esc"]} label="Close" />
        </div>
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="t-label">{label}</span>
    </span>
  );
}
