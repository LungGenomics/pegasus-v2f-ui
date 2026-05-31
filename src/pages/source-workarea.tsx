// Source work-area (redesign) — the right pane when a source is selected.
// Canvas + inspector: the data table is the centerpiece (paged + searchable
// via getRawPage); a right rail holds Metadata / Transforms / Mappings as
// tabs. Editing is local-first/instant (saves on blur; the Publish dirty-bar
// tracks changes). The Transforms/Mappings editors and the Raw/Transformed
// toggle land in the next slices.

import { useEffect, useMemo, useState } from "react";
import {
  transformTypeMeta,
  TRANSFORM_CATEGORY_ORDER,
} from "../data/config-schema/transforms";
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
  RefreshCw,
  Loader2,
  Upload,
} from "lucide-react";
import { getSource, updateSource, removeSource } from "../data/sourceOps";
import { reingestSource } from "../data/pipeline/ingest";
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
import {
  listMappingsForSource,
  insertMapping,
  updateMapping,
  removeMapping,
  type InsertMappingInput,
  type UpdateMappingPatch,
} from "../data/mappingOps";
import { listTraits, findOrCreateByLabel } from "../data/traitOps";
import { requiredFields } from "../data/canonicalFields";
import { rebuildDerived } from "../data/pipeline/derived";
import type {
  ConfigMapping,
  ConfigSource,
  ConfigSourceTransform,
  ConfigTrait,
} from "../api/types";
import {
  TransformParamEditor,
  isTransformIncomplete,
} from "../components/schema-form/transform-param-editor";
import { SchemaFormProvider } from "../components/schema-form/context";
import type { TransformConfigEntry } from "../api/types";
import { MappingCardForm } from "./mapping-form";
import { useSyncSession } from "../hooks/useSyncSession";

type InspectorTab = "details" | "transforms" | "mappings";
const TABS: InspectorTab[] = ["details", "transforms", "mappings"];
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

  const [tab, setTab] = useState<InspectorTab>("details");
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

  // Transformed schema — DESCRIBE on the compiled pipeline. Fetched when the
  // Transformed view is active OR when the Mappings tab is open (mappings'
  // field editor autocompletes raw_column from the post-transform schema).
  const transformedSchemaQ = useQuery({
    queryKey: ["transformed-schema", sourceId],
    enabled:
      !!sourceId &&
      rawCols.length > 0 &&
      (view === "transformed" || tab === "mappings"),
    queryFn: () => getTransformedSchema(sourceId!),
  });
  const transformedCols = transformedSchemaQ.data ?? [];

  const columns = view === "raw" ? rawCols : transformedCols;
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
            {source.description ? (
              <p className="text-xs text-base-content/60 truncate">
                {source.description}
              </p>
            ) : (
              <p className="text-xs italic text-base-content/40">
                No description
              </p>
            )}
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
            {tab === "details" && (
              <DetailsTab
                source={source}
                name={name}
                onDelete={() => void onDelete()}
              />
            )}
            {tab === "transforms" && (
              <TransformsTab sourceId={source.id} rawColumns={rawCols} />
            )}
            {tab === "mappings" && (
              <MappingsTab
                sourceId={source.id}
                sourceName={source.name}
                transformedColumns={transformedCols}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

/** Editable ingest settings + re-ingest. URL/sheet sources can re-fetch from
 *  the (possibly edited) URL; file sources have nothing to re-fetch, so they
 *  re-ingest by re-uploading a file. Either way the raw table is rebuilt
 *  (CREATE OR REPLACE) and raw_version + audit are bumped. */
function IngestSection({
  source,
  name,
  actor,
  qc,
}: {
  source: ConfigSource;
  name: string;
  actor: string | null;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const isFileSource = !source.url;
  const isSheet = source.source_type === "googlesheets";

  const [url, setUrl] = useState(source.url ?? "");
  const [sheet, setSheet] = useState(source.sheet ?? "");
  const [skipRows, setSkipRows] = useState(String(source.skip_rows ?? 0));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(source.url ?? "");
    setSheet(source.sheet ?? "");
    setSkipRows(String(source.skip_rows ?? 0));
    setFile(null);
    setResult(null);
    setError(null);
  }, [source.id, source.url, source.sheet, source.skip_rows]);

  const skipNum = Number.parseInt(skipRows, 10);
  const skipValid = Number.isFinite(skipNum) && skipNum >= 0;

  // File sources need a chosen file to re-ingest; URL sources can always
  // re-fetch (upstream may have changed even with the same settings).
  const canReingest = skipValid && !busy && (isFileSource ? !!file : true);

  const reingest = async () => {
    if (!canReingest) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const patch: { url?: string; sheet?: string; skip_rows?: number } = {};
      if (!isFileSource && url !== (source.url ?? "")) patch.url = url;
      if (isSheet && sheet !== (source.sheet ?? "")) patch.sheet = sheet || undefined;
      if (skipNum !== (source.skip_rows ?? 0)) patch.skip_rows = skipNum;

      const res = await reingestSource(name, patch, file ?? undefined, actor);
      setResult(`Re-ingested ${res.rows.toLocaleString()} rows.`);
      setFile(null);
      // Raw table + schema changed — drop every cached view of this source.
      void qc.invalidateQueries({ queryKey: ["raw-schema", source.id] });
      void qc.invalidateQueries({ queryKey: ["transformed-schema", source.id] });
      void qc.invalidateQueries({ queryKey: ["preview-page"] });
      void qc.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-base-content/40">
          Origin
        </span>
        <span className="text-xs font-mono text-base-content/40">
          {source.source_type}
        </span>
      </div>

      {!isFileSource && (
        <label className="block">
          <FieldHeading>URL</FieldHeading>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="input input-bordered input-sm w-full font-mono text-xs"
            placeholder="https://…"
          />
        </label>
      )}

      {isSheet && (
        <label className="block">
          <FieldHeading>
            Sheet <span className="text-base-content/40">(optional)</span>
          </FieldHeading>
          <input
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
            className="input input-bordered input-sm w-full font-mono text-xs"
            placeholder="first tab if blank"
          />
        </label>
      )}

      <label className="block">
        <FieldHeading>Skip rows</FieldHeading>
        <input
          type="number"
          min={0}
          value={skipRows}
          onChange={(e) => setSkipRows(e.target.value)}
          className={`input input-bordered input-sm w-full font-mono text-xs ${
            skipValid ? "" : "input-error"
          }`}
        />
      </label>

      {isFileSource && (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <span className="btn btn-ghost btn-xs gap-1 shrink-0">
            <Upload className="size-3.5" />
            Choose file
          </span>
          <span className="truncate text-base-content/50">
            {file ? file.name : "re-upload to replace the raw table"}
          </span>
          <input
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}

      <button
        type="button"
        onClick={() => void reingest()}
        disabled={!canReingest}
        className="btn btn-neutral btn-sm gap-1 w-full"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {isFileSource ? "Re-upload" : "Refetch"}
      </button>

      {result && <p className="text-xs text-success">{result}</p>}
      {error && <p className="text-xs text-error break-words">{error}</p>}
    </div>
  );
}

/** Field label, consistent with the Display name / Description labels at the
 *  top of the Details tab. */
function FieldHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-sm font-medium text-base-content/70 mb-1.5">
      {children}
    </span>
  );
}

function DetailsTab({
  source,
  name,
  onDelete,
}: {
  source: ConfigSource;
  name: string;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const session = useSyncSession();
  const actor = session?.login ?? null;
  // Tab-wide draft: edits accumulate locally until Save commits them. Matches
  // the Transforms tab so settings-vs-transforms feel like one editor pattern
  // (mappings stays per-card because each mapping is an independent stream).
  //
  // Display name falls back to `source.name` when no override is set, so the
  // field is editable inline instead of forcing the user to retype the value
  // that's only visible as placeholder text. On save we treat
  // "equals source.name or empty" as "no override" → NULL in DB.
  const persistedDisplayName = source.display_name ?? source.name;
  const persistedDescription = source.description ?? "";
  const [displayName, setDisplayName] = useState(persistedDisplayName);
  const [description, setDescription] = useState(persistedDescription);

  useEffect(() => {
    setDisplayName(persistedDisplayName);
    setDescription(persistedDescription);
  }, [source.id, persistedDisplayName, persistedDescription]);

  const isDirty =
    displayName !== persistedDisplayName ||
    description !== persistedDescription;

  const onSave = async () => {
    await updateSource(
      name,
      {
        display_name:
          !displayName || displayName === source.name ? undefined : displayName,
        description: description || undefined,
      },
      actor,
    );
    void qc.invalidateQueries({ queryKey: ["config"] });
  };
  const onCancel = () => {
    setDisplayName(persistedDisplayName);
    setDescription(persistedDescription);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <label className="block">
          <FieldHeading>Display name</FieldHeading>
          <input
            className={`input input-bordered input-sm w-full ${
              displayName ? "bg-base-200" : ""
            }`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={source.name}
          />
        </label>
        <label className="block">
          <FieldHeading>Description</FieldHeading>
          <textarea
            className={`textarea textarea-bordered textarea-sm w-full ${
              description ? "bg-base-200" : ""
            }`}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
          />
        </label>
        <div className="space-y-0.5">
          <AuditLine
            label="Created"
            actor={source.created_by}
            timestamp={source.created_at}
          />
          <AuditLine
            label="Last edited"
            actor={source.last_edited_by}
            timestamp={source.updated_at}
          />
        </div>

        <button
          type="button"
          onClick={onDelete}
          className="btn btn-error btn-sm gap-1 w-full"
        >
          <Trash2 className="size-3.5" />
          Delete source
        </button>

        {/* Origin settings — editable; committing requires a refetch, which
            rebuilds the raw table from the (possibly new) settings. */}
        <IngestSection source={source} name={name} actor={actor} qc={qc} />
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

// --- Transforms tab ---

/** Picker allow-list of transform DSL types (transform/compile.ts). The legacy
 *  `custom` types (parse_evidence, apply_f_trait) are intentionally omitted —
 *  kept as reference code only. Order here doesn't matter; the picker groups by
 *  category from transformTypeMeta. */
const TRANSFORM_TYPES = [
  "rename",
  "select",
  "concat_columns",
  "format_text",
  "affix",
  "find_replace",
  "extract",
  "split_column",
  "coerce_numeric",
  "normalize_nulls",
  "replace_values",
  "drop_nulls",
  "filter",
  "math",
  "deduplicate",
  "explode_column",
  "aggregate",
  "parse_variant_id",
  "map_gene_id",
  "compute",
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
  const session = useSyncSession();
  const actor = session?.login ?? null;
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
    await replaceSourceTransforms(sourceId, draft, actor);
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

/** Drop the `type` discriminant from the schema editor's output, leaving just
 *  the params we persist. */
function stripType(t: TransformConfigEntry): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...t };
  delete rest.type;
  return rest;
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

  // Compile-time no-op detection — mirrors compile.ts guards. Dim the card
  // body + tag the header so the user sees the step won't apply, but Save
  // still works (transforms are an in-progress pipeline; a half-typed step
  // shouldn't block saving the rest).
  const incomplete = isTransformIncomplete(transform.type, transform.params);

  return (
    <div
      className={`border rounded-lg p-3 space-y-2 ${
        incomplete
          ? "border-warning/30 bg-warning/5"
          : "border-base-300 bg-base-200/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-base-content/40 font-mono shrink-0">
          {seq + 1}.
        </span>
        <span className="text-sm font-medium font-mono truncate flex-1">
          {transform.type}
        </span>
        {incomplete && (
          <span
            title="Missing required params — this step will be skipped at compile."
            className="text-[10px] uppercase tracking-wide text-warning bg-warning/10 px-1.5 py-0.5 rounded shrink-0"
          >
            incomplete
          </span>
        )}
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

      <div>
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
          <SchemaFormProvider columns={rawColumns}>
            <TransformParamEditor
              transform={
                { type: transform.type, ...transform.params } as TransformConfigEntry
              }
              onChange={(next) => onParamsChange(stripType(next))}
            />
          </SchemaFormProvider>
        )}
      </div>
    </div>
  );
}

// --- Mappings tab ---
//
// Per-card save (not tab-level): mappings are independent output streams,
// not a pipeline, so one half-finished card shouldn't block saving another.
// Each card holds its own draft + dirty state and commits via insert/update
// independently. The parent only tracks which "new" (unpersisted) cards
// exist; once a new card saves, it leaves `pendingNew` and reappears via
// the refetched persisted list.

function makeKey(): string {
  return (
    "k_" +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

type PendingNewCard = {
  _key: string;
  /** Default source_tag suggested at add-time. */
  defaultTag: string;
};

function MappingsTab({
  sourceId,
  sourceName,
  transformedColumns,
}: {
  sourceId: string;
  sourceName: string;
  transformedColumns: string[];
}) {
  const qc = useQueryClient();
  const session = useSyncSession();
  const actor = session?.login ?? null;
  const mappingsQ = useQuery({
    queryKey: ["mappings", sourceId],
    enabled: !!sourceId,
    queryFn: () => listMappingsForSource(sourceId),
  });
  const persisted: ConfigMapping[] = mappingsQ.data ?? [];

  // Traits for the constant trait-scope picker. Shared across all cards.
  const traitsQ = useQuery({ queryKey: ["traits"], queryFn: listTraits });
  const traits: ConfigTrait[] = traitsQ.data ?? [];
  const onCreateTrait = async (label: string): Promise<string> => {
    const id = await findOrCreateByLabel(label, actor);
    await qc.invalidateQueries({ queryKey: ["traits"] });
    return id;
  };

  // True while the derived layer rebuilds after a mapping change.
  const [rebuilding, setRebuilding] = useState(false);

  // Only "new" (unpersisted) cards live in tab state. Persisted cards are
  // rendered straight from the query and own their own draft internally.
  const [pendingNew, setPendingNew] = useState<PendingNewCard[]>([]);
  useEffect(() => {
    // Switching sources discards any in-progress new cards from the old one.
    setPendingNew([]);
  }, [sourceId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["mappings", sourceId] });
    // Dirty-tracker sig depends on mappings.
    void qc.invalidateQueries({ queryKey: ["config"] });
    // The derived layer (column-scope traits, evidence, loci, and the gene
    // reference) is a function of the mappings — rebuild it automatically so
    // traits and loci reflect the change without a manual Admin rebuild.
    // Fire-and-forget: the mapping write already succeeded, so a rebuild error
    // must not surface as a save failure.
    setRebuilding(true);
    void rebuildDerived(actor)
      .then(() => qc.invalidateQueries())
      .catch((err) =>
        console.error("Auto-rebuild of derived layer failed:", err),
      )
      .finally(() => setRebuilding(false));
  };

  const addNew = () => {
    const slug = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const n = persisted.length + pendingNew.length + 1;
    setPendingNew((p) => [
      ...p,
      { _key: makeKey(), defaultTag: `${slug}_mapping_${n}` },
    ]);
  };

  const cancelNew = (key: string) =>
    setPendingNew((p) => p.filter((x) => x._key !== key));

  const onSavedNew = (key: string) => {
    cancelNew(key);
    invalidate();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {mappingsQ.isLoading ? (
          <p className="text-xs text-base-content/40 text-center py-4">
            Loading…
          </p>
        ) : persisted.length === 0 && pendingNew.length === 0 ? (
          <p className="text-xs text-base-content/40 text-center py-4">
            No mappings yet — a mapping projects this source into evidence
            rows or loci.
          </p>
        ) : (
          <>
            {persisted.map((m) => (
              <MappingCard
                key={m.id}
                persisted={m}
                sourceId={sourceId}
                transformedColumns={transformedColumns}
                traits={traits}
                onCreateTrait={onCreateTrait}
                onAfterChange={invalidate}
              />
            ))}
            {pendingNew.map((p) => (
              <MappingCard
                key={p._key}
                persisted={null}
                sourceId={sourceId}
                defaultTag={p.defaultTag}
                transformedColumns={transformedColumns}
                traits={traits}
                onCreateTrait={onCreateTrait}
                onSavedNew={() => onSavedNew(p._key)}
                onCancelNew={() => cancelNew(p._key)}
              />
            ))}
          </>
        )}
        <button
          type="button"
          onClick={addNew}
          className="btn btn-primary btn-sm gap-1 w-full"
        >
          <Plus className="size-3.5" />
          Add mapping
        </button>
        {rebuilding && (
          <p className="text-xs text-base-content/40 text-center">
            Rebuilding traits, loci &amp; evidence…
          </p>
        )}
      </div>
    </div>
  );
}

function makeBlankMapping(
  sourceId: string,
  defaultTag: string,
): ConfigMapping {
  return {
    id: "",
    source_id: sourceId,
    source_tag: defaultTag,
    target: "evidence",
  };
}

/** Card holds its own draft + dirty + validity. Save commits via insert
 *  (new) or update (existing); Cancel reverts to the persisted snapshot
 *  (or discards the card if it was never saved). gene_symbol field is
 *  required — Save is disabled without one. */
function MappingCard({
  persisted,
  sourceId,
  defaultTag,
  transformedColumns,
  traits,
  onCreateTrait,
  onAfterChange,
  onSavedNew,
  onCancelNew,
}: {
  /** Null iff this is a new (unpersisted) card. */
  persisted: ConfigMapping | null;
  sourceId: string;
  defaultTag?: string;
  transformedColumns: string[];
  traits: ConfigTrait[];
  onCreateTrait: (label: string) => Promise<string>;
  /** Persisted-card path: called after update/delete so the parent can
   *  refetch. */
  onAfterChange?: () => void;
  /** New-card path: called after a successful insert. */
  onSavedNew?: () => void;
  /** New-card path: called when the user cancels before saving. */
  onCancelNew?: () => void;
}) {
  const session = useSyncSession();
  const actor = session?.login ?? null;
  const initial: ConfigMapping = persisted ?? makeBlankMapping(
    sourceId,
    defaultTag ?? "",
  );
  const [draft, setDraft] = useState<ConfigMapping>(initial);

  // Re-sync the card's draft when the *identity* of its persisted backing
  // changes (e.g. parent swapped to a different source). For the same row,
  // a refetch that returns identical content shouldn't clobber in-progress
  // edits — but since our save path explicitly invalidates after a commit,
  // a content change here means the row genuinely changed elsewhere.
  useEffect(() => {
    setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted?.id, persisted?.row_version]);

  const isNew = !persisted;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Required fields depend on the target (evidence → gene_symbol; loci →
  // chromosome + position). Each must have a non-empty raw_column.
  const missingRequired = requiredFields(draft.target, draft.centric).filter(
    (rf) =>
      !(draft.fields ?? []).some(
        (f) => f.canonical_field === rf && f.raw_column.trim() !== "",
      ),
  );
  const hasAllRequired = missingRequired.length === 0;
  const hasSourceTag = draft.source_tag.trim() !== "";
  // Evidence-target mappings must carry a PEGASUS evidence category and a
  // score column (the per-row score value for that category).
  const needsCategory = draft.target === "evidence";
  const hasCategory =
    !needsCategory || (draft.evidence_category ?? "").trim() !== "";
  const hasScore =
    draft.target !== "evidence" || (draft.score_column ?? "").trim() !== "";
  const canSave =
    hasSourceTag &&
    hasAllRequired &&
    hasCategory &&
    hasScore &&
    (isNew || isDirty);

  const onChange = (patch: Partial<ConfigMapping>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const onSave = async () => {
    if (isNew) {
      const input: InsertMappingInput = {
        source_id: sourceId,
        source_tag: draft.source_tag,
        target: draft.target,
      };
      if (draft.display_name) input.display_name = draft.display_name;
      if (draft.evidence_category)
        input.evidence_category = draft.evidence_category;
      if (draft.score_column) input.score_column = draft.score_column;
      if (draft.centric) input.centric = draft.centric;
      if (draft.trait_scope) input.trait_scope = draft.trait_scope;
      if (draft.window_kb !== undefined) input.window_kb = draft.window_kb;
      if (draft.merge_distance_kb !== undefined)
        input.merge_distance_kb = draft.merge_distance_kb;
      if (draft.fields && draft.fields.length > 0) input.fields = draft.fields;
      if (draft.trait_ids && draft.trait_ids.length > 0)
        input.trait_ids = draft.trait_ids;
      if (draft.trait_column) input.trait_column = draft.trait_column;
      await insertMapping(input, actor);
      onSavedNew?.();
    } else {
      const patch: UpdateMappingPatch = {
        source_tag: draft.source_tag,
        display_name: draft.display_name,
        target: draft.target,
        evidence_category: draft.evidence_category,
        score_column: draft.score_column,
        centric: draft.centric,
        trait_scope: draft.trait_scope,
        window_kb: draft.window_kb,
        merge_distance_kb: draft.merge_distance_kb,
        fields: draft.fields ?? [],
        trait_ids: draft.trait_ids ?? [],
        trait_column: draft.trait_column ?? null,
      };
      await updateMapping(persisted!.id, patch, actor);
      onAfterChange?.();
    }
  };

  const onCancel = () => {
    if (isNew) onCancelNew?.();
    else setDraft(persisted!);
  };

  const onDelete = async () => {
    if (isNew) {
      onCancelNew?.();
      return;
    }
    if (
      !window.confirm(
        `Delete mapping "${persisted!.display_name || persisted!.source_tag}"?`,
      )
    ) {
      return;
    }
    await removeMapping(persisted!.id, actor);
    onAfterChange?.();
  };

  const title = draft.display_name || draft.source_tag || "(unnamed)";
  const showFooter = isNew || isDirty;
  const saveTitle = !hasSourceTag
    ? "Source tag is required"
    : !hasAllRequired
      ? `Map a column for: ${missingRequired.join(", ")}`
      : !hasCategory
        ? "Evidence category is required"
        : !hasScore
          ? "Score column is required for evidence mappings"
          : undefined;

  return (
    <div className="border border-base-300 bg-base-200/60 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate flex-1">{title}</span>
        <span className="text-[10px] uppercase tracking-wide font-mono text-base-content/50 shrink-0">
          {draft.target}
        </span>
        <button
          type="button"
          onClick={() => void onDelete()}
          title={isNew ? "Discard new mapping" : "Delete mapping"}
          className="text-base-content/40 hover:text-error cursor-pointer"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <MappingCardForm
        draft={draft}
        onChange={onChange}
        transformedColumns={transformedColumns}
        traits={traits}
        onCreateTrait={onCreateTrait}
      />
      {showFooter && (
        <div className="pt-2 border-t border-base-300 flex items-center gap-2">
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
            disabled={!canSave}
            title={saveTitle}
            className="btn btn-primary btn-xs flex-1"
          >
            {isNew ? "Save mapping" : "Save changes"}
          </button>
        </div>
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
  const [query, setQuery] = useState("");
  // Index into the flattened, in-display-order list for keyboard navigation.
  const [active, setActive] = useState(0);

  // Picker-allowed transforms (TRANSFORM_TYPES excludes legacy `custom`),
  // resolved to their display metadata.
  const allowed = useMemo(() => {
    const ok = new Set<string>(TRANSFORM_TYPES);
    return transformTypeMeta.filter((m) => ok.has(m.value));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? allowed.filter(
            (m) =>
              m.label.toLowerCase().includes(q) ||
              m.value.toLowerCase().includes(q) ||
              m.description.toLowerCase().includes(q) ||
              m.category.toLowerCase().includes(q),
          )
        : allowed,
    [allowed, q],
  );

  // Group in canonical category order; skip empty categories.
  const groups = useMemo(
    () =>
      TRANSFORM_CATEGORY_ORDER.map((cat) => ({
        cat,
        items: filtered.filter((m) => m.category === cat),
      })).filter((g) => g.items.length > 0),
    [filtered],
  );
  // Flat list matching the rendered order — drives the highlighted index.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = flat[active];
      if (m) onPick(m.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

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
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search transforms…"
        className="input input-bordered input-xs w-full mb-2"
      />
      <div className="max-h-72 overflow-y-auto">
        {flat.length === 0 ? (
          <p className="text-xs text-base-content/40 py-3 text-center">
            No transforms match “{query}”.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.cat} className="mb-1.5 last:mb-0">
              <div className="text-[10px] uppercase tracking-wide text-base-content/40 px-1 pt-1 pb-0.5">
                {g.cat}
              </div>
              {g.items.map((m) => {
                const idx = flat.indexOf(m);
                const isActive = idx === active;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onPick(m.value)}
                    onMouseMove={() => setActive(idx)}
                    className={`w-full text-left rounded px-2 py-1 flex flex-col gap-0.5 cursor-pointer ${
                      isActive ? "bg-base-200" : "hover:bg-base-200/60"
                    }`}
                  >
                    <span className="text-xs font-medium text-base-content/80">
                      {m.label}
                    </span>
                    <span className="text-[11px] leading-tight text-base-content/40">
                      {m.description}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Audit display ---

function fmtAuditTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AuditLine({
  label,
  actor,
  timestamp,
}: {
  label: string;
  actor?: string;
  timestamp?: string;
}) {
  // Render nothing if we have neither — fresh row, no audit captured.
  if (!actor && !timestamp) return null;
  return (
    <p className="text-xs text-base-content/40">
      <span className="text-base-content/60">{label}</span>
      {timestamp && ` · ${fmtAuditTimestamp(timestamp)}`}
      {actor && (
        <>
          {" · "}
          <span className="font-mono">@{actor}</span>
        </>
      )}
    </p>
  );
}
