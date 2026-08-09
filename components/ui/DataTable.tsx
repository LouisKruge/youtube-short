"use client";

import { useMemo, useState } from "react";
import { cn } from "./cn";

export interface Column<T> {
  key: string;
  header: string;
  /** A CSS width — fixed columns keep figures aligned as rows change. */
  width?: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** What to sort on, when it isn't what's rendered. */
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

type Dir = "asc" | "desc";

/**
 * The dense list primitive — the workhorse of the library and log.
 *
 * Rows are 34px, separated by hairlines rather than gaps, so several dozen fit
 * on screen at once. That density is the reason a table is here instead of a
 * grid of thumbnails: the operator is comparing values down a column, and cards
 * make that impossible.
 *
 * Selection is a hover-revealed checkbox in the leading cell, so an unselected
 * table shows no chrome at all until the pointer arrives.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectable,
  selected,
  onSelectedChange,
  onRowClick,
  activeKey,
  initialSort,
  empty,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  /** Row rendered as current — matched against rowKey. */
  activeKey?: string | null;
  initialSort?: { key: string; dir: Dir };
  empty?: React.ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(
    initialSort ?? null,
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const read = column.sortValue ?? (() => "");
    const factor = sort.dir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const x = read(a);
      const y = read(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
      return String(x).localeCompare(String(y)) * factor;
    });
  }, [rows, sort, columns]);

  const allSelected =
    selectable && rows.length > 0 && selected?.size === rows.length;

  function toggleAll() {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? new Set() : new Set(rows.map(rowKey)));
  }

  function toggleOne(key: string) {
    if (!onSelectedChange || !selected) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange(next);
  }

  function headerClick(column: Column<T>) {
    if (!column.sortable) return;
    setSort((current) =>
      current?.key === column.key
        ? { key: column.key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: "desc" },
    );
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">
        <colgroup>
          {selectable && <col style={{ width: 32 }} />}
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>

        <thead>
          <tr className="rule-b bg-s2">
            {selectable && (
              <th className="px-3">
                <Check checked={Boolean(allSelected)} onChange={toggleAll} label="Select all" />
              </th>
            )}
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn(
                    "h-7 px-3 font-normal",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => headerClick(column)}
                      className={cn(
                        "t-label inline-flex items-center gap-1 transition-colors duration-fast ease-ease hover:text-fg-2",
                        active && "text-fg-2",
                      )}
                    >
                      {column.header}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "block h-[4px] w-[4px] rotate-45 border-fg-2 transition-opacity duration-fast",
                          active ? "opacity-100" : "opacity-0",
                          sort?.dir === "asc"
                            ? "-translate-y-[1px] border-l border-t"
                            : "translate-y-[1px] border-b border-r",
                        )}
                      />
                    </button>
                  ) : (
                    <span className="t-label">{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            const isSelected = selected?.has(key) ?? false;
            const isActive = activeKey === key;

            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "group rule-b transition-colors duration-fast ease-ease last:border-b-0",
                  onRowClick && "cursor-pointer",
                  isActive ? "bg-s3" : isSelected ? "bg-s2" : "hover:bg-s2",
                )}
              >
                {selectable && (
                  <td
                    className="px-3 align-middle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Check
                      checked={isSelected}
                      onChange={() => toggleOne(key)}
                      label="Select row"
                      // Hidden until the row is hovered or the box is ticked:
                      // an untouched table shows no controls at all.
                      className={cn(
                        !isSelected &&
                          "opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "h-row max-w-0 truncate px-3 align-middle",
                      column.align === "right" && "text-right",
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The 12px box, as a span.
 *
 * Presentational on purpose: rows that are themselves buttons need the mark
 * without a second interactive element inside them. A nested button is invalid
 * HTML and React refuses to hydrate it, so the interactive `Check` below is only
 * for standalone use.
 */
export function CheckMark({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block h-[12px] w-[12px] shrink-0 rounded-sm border transition-colors duration-fast ease-ease",
        checked ? "border-fg bg-fg" : "border-line-strong",
        className,
      )}
    >
      {checked && (
        <span className="absolute left-[2px] top-[1px] block h-[4px] w-[7px] -rotate-45 border-b border-l border-bg" />
      )}
    </span>
  );
}

/** The standalone, clickable checkbox. Never place this inside another button. */
export function Check({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "group/check block shrink-0 rounded-sm",
        className,
      )}
    >
      <CheckMark
        checked={checked}
        className={checked ? undefined : "group-hover/check:border-fg-3"}
      />
    </button>
  );
}

/**
 * The bar that appears when rows are selected. Anchored to the bottom of the
 * viewport, full-bleed, and it only exists while a selection does — so the
 * table never carries a permanent toolbar it does not need.
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="anim-enter sticky bottom-0 z-20 -mx-6 mt-px flex items-center gap-4 border-t border-line-strong bg-raised px-6 py-2.5">
      <span className="t-num text-xs text-fg">
        {count} selected
      </span>
      <div className="flex items-center gap-1">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="t-label ml-auto transition-colors duration-fast hover:text-fg-2"
      >
        Clear
      </button>
    </div>
  );
}
