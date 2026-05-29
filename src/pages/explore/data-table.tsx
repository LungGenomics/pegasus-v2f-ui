// Small sortable + client-filterable table shared by the Explore browse
// lists. Row counts are small (≤540 loci, hundreds of genes/traits), so
// sorting + filtering are in-memory — no pagination. Mirrors the
// source-workarea preview grid's look (table-sm, pin-rows, clickable
// header sort cycle none→asc→desc).

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Search } from "lucide-react";

const PAGE_SIZES = [25, 50, 100, 250];

export interface Column<T> {
  key: string;
  header: string;
  /** Cell value (also used for sorting unless `sortValue` given). */
  value: (row: T) => string | number | null | undefined;
  /** Sort key override (e.g. numeric when value renders formatted text). */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  mono?: boolean;
  /** Custom cell render (defaults to the formatted `value`). */
  render?: (row: T) => React.ReactNode;
}

function cmp(a: unknown, b: unknown): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1; // nulls last
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<T>({
  rows,
  columns,
  filterKeys,
  filterPlaceholder = "Filter…",
  onRowClick,
  initialSort,
  emptyMessage = "Nothing to show.",
}: {
  rows: T[];
  columns: Column<T>[];
  /** Columns (by key) the filter input matches against. */
  filterKeys: string[];
  filterPlaceholder?: string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null,
  );
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const colByKey = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])),
    [columns],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    const keys = filterKeys.map((k) => colByKey[k]).filter(Boolean);
    return rows.filter((r) =>
      keys.some((c) => String(c!.value(r) ?? "").toLowerCase().includes(q)),
    );
  }, [rows, filter, filterKeys, colByKey]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = colByKey[sort.key];
    if (!col) return filtered;
    const key = col.sortValue ?? col.value;
    const out = [...filtered].sort((a, b) => cmp(key(a), key(b)));
    if (sort.dir === "desc") out.reverse();
    return out;
  }, [filtered, sort, colByKey]);

  const toggleSort = (key: string) =>
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });

  // Client-side pagination over the sorted rows (counts are small). Reset to
  // the first page whenever the result set or page size changes.
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    setPage(0);
  }, [filter, sort, pageSize, rows]);
  const pageRows = useMemo(
    () => sorted.slice(page * pageSize, page * pageSize + pageSize),
    [sorted, page, pageSize],
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="relative mb-2 w-64">
        <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={filterPlaceholder}
          className="input input-bordered input-sm h-7 min-h-7 w-full pl-8 text-xs"
        />
      </div>
      <div className="flex-1 overflow-auto border border-base-300 rounded-lg min-h-0">
        <table className="table table-sm table-pin-rows">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`cursor-pointer select-none whitespace-nowrap ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {active &&
                        (sort!.dir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center text-base-content/40 py-6"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => (
                <tr
                  key={i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "hover cursor-pointer" : ""}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap ${
                        c.align === "right" ? "text-right" : ""
                      } ${c.mono ? "font-mono" : ""}`}
                    >
                      {c.render ? c.render(row) : (c.value(row) ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: row count + page size + pagers — matches the source preview. */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 mt-2 text-xs text-base-content/60">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap">
            {total.toLocaleString()}
            {filtered.length !== rows.length
              ? ` of ${rows.length.toLocaleString()}`
              : ""}{" "}
            rows
          </span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="select select-bordered select-xs"
            title="Rows per page"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            title="Previous page"
            className="text-base-content/40 hover:text-base-content disabled:opacity-30 disabled:hover:text-base-content/40 cursor-pointer"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="whitespace-nowrap">
            Page {page + 1} of {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            title="Next page"
            className="text-base-content/40 hover:text-base-content disabled:opacity-30 disabled:hover:text-base-content/40 cursor-pointer"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
