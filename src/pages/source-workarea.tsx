// Source work-area (redesign) — the right pane when a source is selected.
// Canvas + inspector: the data table is the centerpiece (paged + searchable
// via getRawPage); a right rail holds Metadata / Transforms / Mappings as
// tabs. Editing is local-first/instant (saves on blur; the Publish dirty-bar
// tracks changes). The Transforms/Mappings editors and the Raw/Transformed
// toggle land in the next slices.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  PanelRightClose,
  PanelRightOpen,
  Search,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { getSource, updateSource, removeSource } from "../data/sourceOps";
import { hasRawTable, getRawSchema, getRawPage } from "../data/rawData";
import type { ConfigSource } from "../api/types";

type InspectorTab = "settings" | "transforms" | "mappings";
const TABS: InspectorTab[] = ["settings", "transforms", "mappings"];
const PAGE_SIZES = [25, 50, 100, 250];
const SEARCH_DEBOUNCE_MS = 200;

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function SourceWorkArea({
  name,
  onDeleted,
}: {
  name: string;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const srcQ = useQuery({
    queryKey: ["config", "source", name],
    queryFn: () => getSource(name),
  });
  const source = srcQ.data ?? null;
  const sourceId = source?.id;

  const [tab, setTab] = useState<InspectorTab>("settings");
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Paging + search
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{
    column: string;
    dir: "asc" | "desc";
  } | null>(null);

  const toggleSort = (col: string) => {
    setSort((s) => {
      if (!s || s.column !== col) return { column: col, dir: "asc" };
      if (s.dir === "asc") return { column: col, dir: "desc" };
      return null;
    });
  };

  // Debounce the search input so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to first page when search / page size / sort / source changes.
  useEffect(() => {
    setPage(0);
  }, [search, pageSize, sourceId, sort]);

  // Schema (columns) for the header + global-search column list.
  const schemaQ = useQuery({
    queryKey: ["raw-schema", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const id = sourceId!;
      if (!(await hasRawTable(id))) return [];
      return getRawSchema(id);
    },
  });
  const columns = (schemaQ.data ?? []).map((c) => c.name);
  const hasRaw = !schemaQ.isLoading && columns.length > 0;

  // Current page of rows.
  const pageQ = useQuery({
    queryKey: ["raw-page", sourceId, pageSize, page, search, sort],
    enabled: hasRaw,
    queryFn: () =>
      getRawPage(sourceId!, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: sort?.column,
        dir: sort?.dir,
        search: search ? { query: search, columns } : undefined,
      }),
  });

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete source "${name}"? This removes its config and raw table.`,
      )
    ) {
      return;
    }
    await removeSource(name);
    void qc.invalidateQueries({ queryKey: ["config"] });
    onDeleted();
  };

  if (srcQ.isLoading) {
    return <div className="text-sm text-base-content/40">Loading…</div>;
  }
  if (!source) {
    return <div className="text-sm text-base-content/40">Source not found.</div>;
  }

  const totalRows = pageQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div
      className={`grid gap-4 ${
        inspectorOpen ? "grid-cols-[1fr_340px]" : "grid-cols-[1fr]"
      }`}
    >
      {/* Center column: header + data table */}
      <section className="min-w-0">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {source.display_name || source.name}
            </h1>
            <p className="text-xs text-base-content/40 font-mono">
              {source.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen((o) => !o)}
            title={inspectorOpen ? "Collapse panel" : "Expand panel"}
            className="shrink-0 mt-0.5 text-base-content/40 hover:text-base-content cursor-pointer"
          >
            {inspectorOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </button>
        </div>

        {/* Raw data toolbar */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
            Raw data
          </span>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-base-content/40 pointer-events-none z-10" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Filter rows…"
                disabled={!hasRaw}
                className="input input-bordered input-xs w-48 pl-7"
              />
            </div>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              disabled={!hasRaw}
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
        </div>

        {/* Table */}
        <div className="border border-base-300 rounded-lg overflow-auto max-h-[calc(100vh-17rem)]">
          {schemaQ.isLoading ? (
            <div className="p-8 text-center text-sm text-base-content/40">
              Loading…
            </div>
          ) : !hasRaw ? (
            <div className="p-8 text-center text-sm text-base-content/40">
              No raw table for this source.
            </div>
          ) : pageQ.isError ? (
            <div className="p-4 text-sm text-error">
              {(pageQ.error as Error)?.message ?? "Failed to read raw table."}
            </div>
          ) : (
            <table className="table table-xs table-pin-rows">
              <thead>
                <tr>
                  {columns.map((c) => {
                    const active = sort?.column === c;
                    return (
                      <th
                        key={c}
                        onClick={() => toggleSort(c)}
                        title="Click to sort"
                        className="font-mono whitespace-nowrap cursor-pointer select-none hover:bg-base-200"
                      >
                        <span className="inline-flex items-center gap-1">
                          {c}
                          {active && sort.dir === "asc" && (
                            <ChevronUp className="size-3" />
                          )}
                          {active && sort.dir === "desc" && (
                            <ChevronDown className="size-3" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(pageQ.data?.rows ?? []).map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c} className="font-mono whitespace-nowrap">
                        {fmtCell(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {hasRaw && (
          <div className="flex items-center justify-between mt-2 text-xs text-base-content/60">
            <span>
              {totalRows.toLocaleString()} {search ? "matching " : ""}rows ·{" "}
              {columns.length} columns
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || pageQ.isLoading}
                title="Previous page"
                className="text-base-content/40 hover:text-base-content disabled:opacity-30 disabled:hover:text-base-content/40 cursor-pointer"
              >
                <ArrowLeft className="size-4" />
              </button>
              <span>
                Page {page + 1} of {totalPages.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1 || pageQ.isLoading}
                title="Next page"
                className="text-base-content/40 hover:text-base-content disabled:opacity-30 disabled:hover:text-base-content/40 cursor-pointer"
              >
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Right: inspector rail — toggled from the header, top-aligned with
          the left list. Hidden entirely when collapsed (table goes full-width). */}
      {inspectorOpen && (
        <aside className="border border-base-300 rounded-lg overflow-hidden flex flex-col">
          <div className="flex border-b border-base-300 shrink-0">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors cursor-pointer ${
                  tab === t
                    ? "text-primary border-b-2 border-primary"
                    : "text-base-content/50 hover:text-base-content"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="p-4 flex-1 overflow-auto">
            {tab === "settings" && (
              <SettingsTab
                source={source}
                name={name}
                onDelete={() => void onDelete()}
              />
            )}
            {tab === "transforms" && (
              <p className="text-sm text-base-content/40 text-center py-8">
                Transforms editor — next slice. Clean the raw with DSL steps;
                adds the Raw / Transformed toggle to the table.
              </p>
            )}
            {tab === "mappings" && (
              <p className="text-sm text-base-content/40 text-center py-8">
                Mappings editor — next slice. Project the cleaned data into
                evidence or loci.
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function SettingsTab({
  source,
  name,
  onDelete,
}: {
  source: ConfigSource;
  name: string;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setDisplayName(source.display_name ?? "");
    setDescription(source.description ?? "");
  }, [source.id, source.display_name, source.description]);

  const save = async (patch: {
    display_name?: string;
    description?: string;
  }) => {
    await updateSource(name, patch);
    void qc.invalidateQueries({ queryKey: ["config"] });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-base-content/70 mb-1.5">
          Display name
        </span>
        <input
          className="input input-bordered input-sm w-full"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => {
            if (displayName !== (source.display_name ?? "")) {
              void save({ display_name: displayName || undefined });
            }
          }}
          placeholder={source.name}
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-base-content/70 mb-1.5">
          Description
        </span>
        <textarea
          className="textarea textarea-bordered textarea-sm w-full"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (source.description ?? "")) {
              void save({ description: description || undefined });
            }
          }}
          placeholder="optional"
        />
      </label>
      {/* Read-only ingest info — editing url/skip-rows implies a re-ingest,
          handled separately. */}
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-base-content/40">Type</dt>
          <dd className="font-mono">{source.source_type}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-base-content/40">Skip rows</dt>
          <dd className="font-mono">{source.skip_rows ?? 0}</dd>
        </div>
        {source.sheet && (
          <div className="flex justify-between">
            <dt className="text-base-content/40">Sheet</dt>
            <dd className="font-mono">{source.sheet}</dd>
          </div>
        )}
        {source.url && (
          <div>
            <dt className="text-base-content/40">URL</dt>
            <dd className="font-mono break-all">{source.url}</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        onClick={onDelete}
        className="btn btn-error btn-sm gap-1 w-full"
      >
        <Trash2 className="size-3.5" />
        Delete source
      </button>
    </div>
  );
}
