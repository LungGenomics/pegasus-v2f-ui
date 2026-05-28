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
  Plus,
  X,
} from "lucide-react";
import { getSource, updateSource, removeSource } from "../data/sourceOps";
import {
  hasRawTable,
  getRawSchema,
  getRawPage,
  getTransformedSchema,
  getTransformedPage,
  type RawPageRequest,
} from "../data/rawData";
import {
  listSourceTransforms,
  replaceSourceTransforms,
} from "../data/sourceTransformOps";
import type { ConfigSource, ConfigSourceTransform } from "../api/types";
import { TransformParamsEditor } from "./transform-form";

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
  const [view, setView] = useState<"raw" | "transformed">("raw");

  // Transformed columns can differ from raw (rename/select/explode), so any
  // active sort would point at a column that may not exist after switching.
  useEffect(() => {
    setSort(null);
  }, [view]);

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

  // Reset to first page when search / page size / sort / source / view changes.
  useEffect(() => {
    setPage(0);
  }, [search, pageSize, sourceId, sort, view]);

  // Raw schema — always loaded (used for the Raw view + as the "raw exists"
  // check for the Transformed view, which depends on the raw table).
  const rawSchemaQ = useQuery({
    queryKey: ["raw-schema", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const id = sourceId!;
      if (!(await hasRawTable(id))) return [];
      return getRawSchema(id);
    },
  });
  const rawCols = (rawSchemaQ.data ?? []).map((c) => c.name);

  // Transformed schema — DESCRIBE on the compiled pipeline; only fetched
  // when the Transformed view is active and a raw table exists.
  const transformedSchemaQ = useQuery({
    queryKey: ["transformed-schema", sourceId],
    enabled: !!sourceId && view === "transformed" && rawCols.length > 0,
    queryFn: () => getTransformedSchema(sourceId!),
  });

  const columns =
    view === "raw" ? rawCols : (transformedSchemaQ.data ?? []);
  const activeSchemaQ = view === "raw" ? rawSchemaQ : transformedSchemaQ;
  const hasRaw = !activeSchemaQ.isLoading && columns.length > 0;

  // Current page of rows — same WHERE/ORDER/LIMIT shape for both views; the
  // base table differs (main.raw_<id> vs the compiled pipeline).
  const pageQ = useQuery({
    queryKey: ["preview-page", view, sourceId, pageSize, page, search, sort],
    enabled: hasRaw,
    queryFn: () => {
      const req: RawPageRequest = {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: sort?.column,
        dir: sort?.dir,
        search: search ? { query: search, columns } : undefined,
      };
      return view === "raw"
        ? getRawPage(sourceId!, req)
        : getTransformedPage(sourceId!, req);
    },
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
      className={`grid gap-4 h-full ${
        inspectorOpen ? "grid-cols-[1fr_340px]" : "grid-cols-[1fr]"
      }`}
    >
      {/* Center column: header + data table */}
      <section className="min-w-0 h-full flex flex-col min-h-0">
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

        {/* Toolbar: Raw / Transformed toggle, search, page size */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div
            role="tablist"
            className="inline-flex bg-base-200 rounded-md p-0.5 text-xs"
          >
            {(["raw", "transformed"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md transition-colors capitalize cursor-pointer ${
                  view === v
                    ? "bg-base-100 text-base-content font-medium shadow-sm"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-base-content/40 pointer-events-none z-10" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter rows…"
              disabled={!hasRaw}
              className="input input-bordered input-xs h-7 min-h-7 w-48 pl-7"
            />
          </div>
        </div>

        {/* Table */}
        <div className="border border-base-300 rounded-lg overflow-auto flex-1 min-h-0">
          {activeSchemaQ.isLoading ? (
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
          <div className="flex flex-wrap items-center justify-between gap-y-2 mt-2 text-xs text-base-content/60">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap">
                {totalRows.toLocaleString()} {search ? "matching " : ""}rows ·{" "}
                {columns.length} columns
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
                disabled={page === 0 || pageQ.isLoading}
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
          <div className="flex-1 min-h-0 flex flex-col">
            {tab === "settings" && (
              <div className="flex-1 overflow-auto p-4">
                <SettingsTab
                  source={source}
                  name={name}
                  onDelete={() => void onDelete()}
                />
              </div>
            )}
            {tab === "transforms" && (
              <TransformsTab sourceId={source.id} rawColumns={rawCols} />
            )}
            {tab === "mappings" && (
              <div className="flex-1 overflow-auto p-4">
                <p className="text-sm text-base-content/40 text-center py-8">
                  Mappings editor — next slice. Project the cleaned data into
                  evidence or loci.
                </p>
              </div>
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

// --- Transforms tab ---

/** Supported transform DSL types (transform/compile.ts). The two legacy
 *  "custom" types (parse_evidence, apply_f_trait) are intentionally omitted
 *  from the picker — they're not part of the redesigned authoring model. */
const TRANSFORM_TYPES = [
  "rename",
  "select",
  "deduplicate",
  "strip_prefix",
  "uppercase",
  "drop_nulls",
  "coerce_numeric",
  "filter_values",
  "parse_variant_id",
  "split_column",
  "explode_column",
  "aggregate",
  "compute",
  "map_gene_id",
] as const;

type DraftStep = { type: string; params: Record<string, unknown> };

function TransformsTab({
  sourceId,
  rawColumns,
}: {
  sourceId: string;
  rawColumns: string[];
}) {
  const qc = useQueryClient();
  const transformsQ = useQuery({
    queryKey: ["source-transforms", sourceId],
    enabled: !!sourceId,
    queryFn: () => listSourceTransforms(sourceId),
  });
  const persisted: DraftStep[] = (transformsQ.data ?? []).map((t) => ({
    type: t.type,
    params: (t.params ?? {}) as Record<string, unknown>,
  }));
  const persistedSig = JSON.stringify(persisted);

  // Draft = all in-progress edits. Edits never touch the DB / preview cache
  // until Save. Resyncs from `persisted` whenever the source switches or the
  // persisted pipeline truly changes (after Save).
  const [draft, setDraft] = useState<DraftStep[]>(persisted);
  useEffect(() => {
    setDraft(persisted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedSig, sourceId]);

  const [adding, setAdding] = useState(false);
  const isDirty = JSON.stringify(draft) !== persistedSig;

  const addStep = (type: string) => {
    setAdding(false);
    setDraft([...draft, { type, params: {} }]);
  };
  const removeStep = (i: number) =>
    setDraft(draft.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = draft.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setDraft(next);
  };
  const updateParams = (i: number, params: Record<string, unknown>) =>
    setDraft(draft.map((t, idx) => (idx === i ? { ...t, params } : t)));

  const onSave = async () => {
    await replaceSourceTransforms(sourceId, draft);
    void qc.invalidateQueries({
      queryKey: ["source-transforms", sourceId],
    });
    // The transformed view depends on the pipeline — refresh its schema +
    // current page so the table reflects the new transforms.
    void qc.invalidateQueries({
      queryKey: ["transformed-schema", sourceId],
    });
    void qc.invalidateQueries({ queryKey: ["preview-page"] });
    // Dirty-tracker sig includes source_transforms, so the Publish bar
    // (which keys on ["config"]) needs to recompute.
    void qc.invalidateQueries({ queryKey: ["config"] });
  };
  const onCancel = () => {
    setAdding(false);
    setDraft(persisted);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {draft.length === 0 && !adding && (
          <p className="text-xs text-base-content/40 text-center py-4">
            No transforms yet — add steps to clean the raw data (parse IDs,
            filter rows, dedupe, …).
          </p>
        )}
        {draft.map((t, i) => (
          <TransformStepCard
            key={i}
            seq={i}
            transform={{
              seq: i,
              type: t.type,
              params: t.params,
            } as ConfigSourceTransform}
            rawColumns={rawColumns}
            canMoveUp={i > 0}
            canMoveDown={i < draft.length - 1}
            onParamsChange={(p) => updateParams(i, p)}
            onMove={(dir) => moveStep(i, dir)}
            onRemove={() => removeStep(i)}
          />
        ))}
        {adding ? (
          <AddStepPicker onPick={addStep} onCancel={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn btn-primary btn-sm gap-1 w-full"
          >
            <Plus className="size-3.5" />
            Add step
          </button>
        )}
      </div>
      {isDirty && (
        <div className="shrink-0 px-3 py-2 border-t border-base-300 bg-base-100 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost btn-xs flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="btn btn-primary btn-xs flex-1"
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function TransformStepCard({
  seq,
  transform,
  rawColumns,
  canMoveUp,
  canMoveDown,
  onParamsChange,
  onMove,
  onRemove,
}: {
  seq: number;
  transform: ConfigSourceTransform;
  rawColumns: string[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onParamsChange: (params: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);

  // JSON editor state (only used when `advanced`).
  const stringify = (p: Record<string, unknown>) =>
    JSON.stringify(p ?? {}, null, 2);
  const [json, setJson] = useState(() => stringify(transform.params));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setJson(stringify(transform.params));
    setErr(null);
  }, [transform.type, transform.params]);

  const commitJson = () => {
    try {
      const parsed = JSON.parse(json || "{}");
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setErr("Params must be a JSON object");
        return;
      }
      setErr(null);
      if (JSON.stringify(parsed) !== JSON.stringify(transform.params ?? {})) {
        onParamsChange(parsed as Record<string, unknown>);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="border border-base-300 bg-base-200/60 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-base-content/40 font-mono shrink-0">
          {seq + 1}.
        </span>
        <span className="text-sm font-medium font-mono truncate flex-1">
          {transform.type}
        </span>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          title={advanced ? "Switch to form view" : "Edit raw JSON"}
          className={`text-[11px] cursor-pointer ${
            advanced
              ? "text-primary hover:text-primary/80"
              : "text-base-content/40 hover:text-base-content"
          }`}
        >
          {advanced ? "Form" : "JSON"}
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!canMoveUp}
          title="Move up"
          className="text-base-content/40 hover:text-base-content disabled:opacity-30 cursor-pointer"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!canMoveDown}
          title="Move down"
          className="text-base-content/40 hover:text-base-content disabled:opacity-30 cursor-pointer"
        >
          <ChevronDown className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove step"
          className="text-base-content/40 hover:text-error cursor-pointer"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {advanced ? (
        <>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            onBlur={commitJson}
            rows={Math.max(2, Math.min(8, json.split("\n").length))}
            spellCheck={false}
            className={`textarea textarea-bordered textarea-sm w-full font-mono text-xs leading-snug ${err ? "textarea-error" : ""}`}
            placeholder="{}"
          />
          {err && <p className="text-xs text-error">{err}</p>}
        </>
      ) : (
        <TransformParamsEditor
          type={transform.type}
          params={transform.params}
          columns={rawColumns}
          onChange={onParamsChange}
        />
      )}
    </div>
  );
}

function AddStepPicker({
  onPick,
  onCancel,
}: {
  onPick: (type: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-base-300 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-base-content/70">
          Pick a transform
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-base-content/40 hover:text-base-content cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {TRANSFORM_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="px-2 py-1 text-xs text-left rounded font-mono text-base-content/70 hover:bg-base-200 hover:text-base-content cursor-pointer"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
