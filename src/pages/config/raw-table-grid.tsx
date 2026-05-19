// Phase 2 — read-only raw-table grid. The first-class "look through
// the data" surface: paged/sorted/filtered window over main.raw_<id>,
// with per-column type + null% + approx-distinct. Read-only by design
// (D5): raw is provenance, never edited in place.

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { getRawStats, getRawPage } from "../../data/rawData";

const PAGE_SIZES = [50, 100, 250];

function cell(v: unknown): { text: string; muted: boolean } {
  if (v === null || v === undefined) return { text: "∅", muted: true };
  if (typeof v === "bigint") return { text: v.toString(), muted: false };
  if (typeof v === "object") return { text: JSON.stringify(v), muted: false };
  const s = String(v);
  if (s === "") return { text: "(empty)", muted: true };
  return { text: s, muted: false };
}

export function RawTableGrid({ sourceId }: { sourceId: string }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(
    null,
  );
  const [filters, setFilters] = useState<Record<string, string>>({});

  const statsQ = useQuery({
    queryKey: ["raw-stats", sourceId],
    queryFn: () => getRawStats(sourceId),
  });

  const activeFilters = Object.entries(filters)
    .filter(([, v]) => v.trim() !== "")
    .map(([column, contains]) => ({ column, contains }));

  const pageQ = useQuery({
    queryKey: [
      "raw-page",
      sourceId,
      page,
      pageSize,
      sort?.col,
      sort?.dir,
      JSON.stringify(activeFilters),
    ],
    queryFn: () =>
      getRawPage(sourceId, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: sort?.col,
        dir: sort?.dir,
        filters: activeFilters,
      }),
    placeholderData: keepPreviousData,
  });

  if (statsQ.isLoading)
    return (
      <div className="text-sm text-base-content/40 flex items-center gap-2 p-4">
        <Loader2 className="size-3.5 animate-spin" /> Reading raw table…
      </div>
    );
  if (statsQ.error)
    return (
      <div className="text-sm text-error p-4">
        Couldn't read raw table: {(statsQ.error as Error).message}
      </div>
    );

  const cols = statsQ.data?.columns ?? [];
  if (cols.length === 0)
    return (
      <div className="text-sm text-base-content/50 p-4">
        Raw table has no columns.
      </div>
    );

  const filtered = pageQ.data?.total ?? 0;
  const grandTotal = statsQ.data?.total ?? 0;
  const from = filtered === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, filtered);
  const lastPage = Math.max(0, Math.ceil(filtered / pageSize) - 1);

  const toggleSort = (col: string) =>
    setSort((s) =>
      s?.col !== col
        ? { col, dir: "asc" }
        : s.dir === "asc"
          ? { col, dir: "desc" }
          : null,
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-base-content/50 flex-wrap">
        <span>
          {filtered.toLocaleString()}
          {filtered !== grandTotal && (
            <> of {grandTotal.toLocaleString()}</>
          )}{" "}
          row{filtered === 1 ? "" : "s"}
          {activeFilters.length > 0 && " (filtered)"}
        </span>
        <span>·</span>
        <span>{cols.length} columns</span>
        <div className="flex-1" />
        {pageQ.isFetching && <Loader2 className="size-3 animate-spin" />}
        <select
          className="select select-bordered select-xs"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
        <div className="join">
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ‹
          </button>
          <span className="btn btn-xs join-item no-animation pointer-events-none">
            {from.toLocaleString()}–{to.toLocaleString()}
          </span>
          <button
            type="button"
            className="btn btn-xs join-item"
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
          >
            ›
          </button>
        </div>
      </div>

      <div className="border border-base-300 rounded-lg bg-base-100 overflow-auto max-h-[60vh]">
        <table className="table table-xs table-pin-rows">
          <thead>
            <tr>
              {cols.map((c) => {
                const sorted = sort?.col === c.name;
                return (
                  <th
                    key={c.name}
                    className="align-top whitespace-nowrap cursor-pointer hover:bg-base-200/60 select-none"
                    onClick={() => toggleSort(c.name)}
                    title="Click to sort"
                  >
                    <div className="flex items-center gap-1 font-medium">
                      {c.name}
                      {sorted &&
                        (sort!.dir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </div>
                    <div className="font-normal text-[10px] text-base-content/40 lowercase">
                      {c.type} · {Math.round(c.nullFrac * 100)}% null ·{" "}
                      {c.distinct.toLocaleString()} distinct
                    </div>
                  </th>
                );
              })}
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={c.name} className="p-1">
                  <input
                    className="input input-bordered input-xs w-full font-normal"
                    placeholder="filter…"
                    value={filters[c.name] ?? ""}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, [c.name]: e.target.value }));
                      setPage(0);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(pageQ.data?.rows ?? []).map((row, i) => (
              <tr key={i} className="hover">
                {cols.map((c) => {
                  const { text, muted } = cell(row[c.name]);
                  return (
                    <td
                      key={c.name}
                      className={`whitespace-nowrap max-w-[24rem] truncate ${
                        muted ? "text-base-content/30 italic" : ""
                      }`}
                      title={text}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {pageQ.data && pageQ.data.rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  className="text-center text-sm text-base-content/40 py-6"
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
