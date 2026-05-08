import { useState, useEffect, useMemo } from "react";
import * as aq from "arquero";
import { type ColumnTable } from "arquero";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Pencil,
  Hammer,
  Database,
  ArrowRight,
  Tag,
} from "lucide-react";
import { getDataSource } from "../../data/select";
import { useGeneMap, usePatchSource } from "../../api/config";
import { applyTransformations, type TransformConfig } from "../../lib/transforms";
import { useConfigDraft } from "./config-draft-context";
import { TransformEditor } from "./transform-editor";
import { TransformPicker } from "./transform-picker";
import { EvidenceEditor } from "./evidence-editor";
import type { V2fSourceConfig, TransformConfigEntry } from "../../api/types";

// --- Transform category colors ---

const TRANSFORM_COLORS: Record<string, { dot: string; border: string; bg: string }> = {
  // Column ops
  rename:        { dot: "bg-blue-400",   border: "border-blue-400/30",   bg: "bg-blue-400/5" },
  select:        { dot: "bg-blue-400",   border: "border-blue-400/30",   bg: "bg-blue-400/5" },
  drop_nulls:    { dot: "bg-blue-400",   border: "border-blue-400/30",   bg: "bg-blue-400/5" },
  // Value ops
  filter_values:   { dot: "bg-amber-400",  border: "border-amber-400/30",  bg: "bg-amber-400/5" },
  coerce_numeric:  { dot: "bg-amber-400",  border: "border-amber-400/30",  bg: "bg-amber-400/5" },
  strip_prefix:    { dot: "bg-amber-400",  border: "border-amber-400/30",  bg: "bg-amber-400/5" },
  uppercase:       { dot: "bg-amber-400",  border: "border-amber-400/30",  bg: "bg-amber-400/5" },
  // Row ops
  deduplicate: { dot: "bg-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/5" },
  aggregate:   { dot: "bg-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/5" },
  // Structural
  split_column:      { dot: "bg-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/5" },
  compute:           { dot: "bg-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/5" },
  parse_variant_id:  { dot: "bg-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/5" },
  // Gene mapping
  map_gene_id: { dot: "bg-teal-400", border: "border-teal-400/30", bg: "bg-teal-400/5" },
};

function getTransformColor(type: string) {
  return TRANSFORM_COLORS[type] ?? { dot: "bg-base-content/30", border: "border-base-300", bg: "bg-base-100" };
}

// --- Main component ---

interface Props {
  source: V2fSourceConfig;
}

export function SourceDetail({ source }: Props) {
  const [rawTable, setRawTable] = useState<ColumnTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { draft, editing, dirty, startEditing, cancelEditing, setTransforms, setEvidence, getDraft } =
    useConfigDraft();

  const patchSource = usePatchSource();

  const { data: geneMapRaw } = useGeneMap();
  const geneMap = useMemo(() => {
    if (!geneMapRaw) return undefined;
    return new Map(Object.entries(geneMapRaw));
  }, [geneMapRaw]);

  useEffect(() => {
    let cancelled = false;
    setRawTable(null);
    setLoadError(null);

    async function fetchData() {
      setLoading(true);
      try {
        const rows = await loadSourceData(source);
        if (cancelled) return;
        if (rows.length === 0) {
          setLoadError("No data returned");
          return;
        }
        setRawTable(aq.from(rows));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchData();
    return () => { cancelled = true; };
  }, [source.name, source.source_type, source.url]);

  const activeTransforms = editing
    ? ((draft?.transformations ?? []) as TransformConfig[])
    : ((source.transformations ?? []) as TransformConfig[]);

  const pipeline = useMemo(() => {
    if (!rawTable) return null;
    if (activeTransforms.length === 0) return null;
    return applyTransformations(rawTable, activeTransforms, geneMap);
  }, [rawTable, activeTransforms, geneMap]);

  const columnsAtStage = useMemo(() => {
    const result: string[][] = [];
    if (!rawTable) return result;
    result.push(rawTable.columnNames());
    if (pipeline) {
      for (const stage of pipeline.stages) {
        result.push(stage.columnNames);
      }
    }
    return result;
  }, [rawTable, pipeline]);

  const finalColumns: string[] = columnsAtStage.length > 0
    ? columnsAtStage[columnsAtStage.length - 1] ?? []
    : [];

  const activeEvidence = editing
    ? (draft?.evidence ?? [])
    : Array.isArray(source.evidence)
      ? source.evidence
      : source.evidence ? [source.evidence] : [];

  const readOnlyEvidence = Array.isArray(source.evidence)
    ? source.evidence
    : source.evidence ? [source.evidence] : [];

  const handleSave = (build: boolean) => {
    const d = getDraft();
    if (!d) return;
    patchSource.mutate(
      { name: source.name, source: d, build },
      { onSuccess: () => cancelEditing() },
    );
  };

  return (
    <div className="space-y-4">
      {/* Compact header bar */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg bg-base-100 ${editing ? "ring-2 ring-primary/20" : ""}`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h2 className="font-semibold text-sm truncate">{source.display_name ?? source.name}</h2>
          <span className="text-base-content/30">·</span>
          <span className="text-xs text-base-content/40 shrink-0">{source.source_type}</span>
          {readOnlyEvidence.map((e, i) => (
            <span key={i} className="badge badge-xs text-[10px]">{e.category}</span>
          ))}
          {source.sheet && (
            <>
              <span className="text-base-content/30">·</span>
              <span className="text-xs text-base-content/40 truncate">{source.sheet}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!editing ? (
            <button className="btn btn-sm btn-ghost gap-1" onClick={() => startEditing(source)}>
              <Pencil className="size-3.5" /> Edit
            </button>
          ) : (
            <>
              <button className="btn btn-xs btn-ghost" onClick={cancelEditing} disabled={patchSource.isPending}>
                Cancel
              </button>
              <button
                className="btn btn-xs btn-primary gap-1"
                onClick={() => handleSave(false)}
                disabled={!dirty || patchSource.isPending}
              >
                {patchSource.isPending && <Loader2 className="size-3 animate-spin" />}
                Save
              </button>
              <button
                className="btn btn-xs btn-secondary gap-1"
                onClick={() => handleSave(true)}
                disabled={!dirty || patchSource.isPending}
              >
                <Hammer className="size-3" />
                Build
              </button>
            </>
          )}
        </div>
      </div>

      {patchSource.isError && (
        <div role="alert" className="alert alert-error alert-sm text-sm">
          {patchSource.error.message}
        </div>
      )}

      {/* Pipeline summary bar */}
      {rawTable && (
        <PipelineSummary
          rawRowCount={rawTable.numRows()}
          transforms={activeTransforms}
          pipeline={pipeline}
          evidence={readOnlyEvidence}
        />
      )}

      {/* Loading / error states */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-base-content/50 py-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading data...
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 text-sm text-warning py-4">
          <AlertTriangle className="size-4" /> {loadError}
        </div>
      )}

      {/* Pipeline timeline */}
      {rawTable && (
        <div className="relative pl-8">
          {/* Continuous vertical rail */}
          <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-base-300" />

          {/* Raw data node */}
          <TimelineNode
            marker={<div className="w-2.5 h-2.5 rounded-full border-2 border-base-content/30 bg-base-100" />}
          >
            <StageBlock
              label="Raw data"
              rowCount={rawTable.numRows()}
              columnCount={rawTable.columnNames().length}
              table={rawTable}
              variant="data"
            />
          </TimelineNode>

          {/* Transform nodes */}
          {activeTransforms.map((t, i) => {
            const stage = pipeline?.stages[i];
            const colors = getTransformColor(t.type);

            return (
              <TimelineNode
                key={i}
                marker={<div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />}
              >
                {editing ? (
                  <div className={`rounded-lg border ${colors.border} ${colors.bg}`}>
                    <TransformEditor
                      config={t as TransformConfigEntry}
                      availableColumns={columnsAtStage[i] ?? []}
                      preview={stage ? {
                        rowCount: stage.rowCount,
                        columnNames: stage.columnNames,
                        table: stage.table,
                        error: stage.error,
                      } : undefined}
                      onChange={(updated) => {
                        const next = [...activeTransforms];
                        next[i] = updated;
                        setTransforms(next as TransformConfigEntry[]);
                      }}
                      onRemove={() => {
                        setTransforms(activeTransforms.filter((_, j) => j !== i) as TransformConfigEntry[]);
                      }}
                      onMoveUp={() => {
                        if (i === 0) return;
                        const next = [...activeTransforms];
                        const tmp = next[i - 1]!;
                        next[i - 1] = next[i]!;
                        next[i] = tmp;
                        setTransforms(next as TransformConfigEntry[]);
                      }}
                      onMoveDown={() => {
                        if (i === activeTransforms.length - 1) return;
                        const next = [...activeTransforms];
                        const tmp = next[i]!;
                        next[i] = next[i + 1]!;
                        next[i + 1] = tmp;
                        setTransforms(next as TransformConfigEntry[]);
                      }}
                      isFirst={i === 0}
                      isLast={i === activeTransforms.length - 1}
                    />
                  </div>
                ) : (
                  <StageBlock
                    label={stage ? formatTransformLabel(stage.transform) : formatTransformLabel(t as TransformConfig)}
                    rowCount={stage?.rowCount ?? 0}
                    columnCount={stage?.columnNames.length ?? 0}
                    table={stage?.table ?? rawTable}
                    error={stage?.error}
                    config={t as TransformConfig}
                    variant="transform"
                    colors={colors}
                  />
                )}
              </TimelineNode>
            );
          })}

          {/* Add transform node (editing) */}
          {editing && (
            <TimelineNode
              marker={<div className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-base-content/20 bg-base-100" />}
            >
              <div className="border border-dashed border-base-300 rounded-lg px-3 py-2">
                <TransformPicker
                  onAdd={(config) => {
                    setTransforms([...activeTransforms, config] as TransformConfigEntry[]);
                  }}
                />
              </div>
            </TimelineNode>
          )}

          {/* No transforms message */}
          {activeTransforms.length === 0 && !editing && (
            <TimelineNode
              marker={<div className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-base-content/15 bg-base-100" />}
            >
              <p className="text-sm text-base-content/30 italic py-1">No transforms</p>
            </TimelineNode>
          )}

          {/* Evidence node */}
          <TimelineNode
            marker={
              <div className="w-3 h-3 rotate-45 border-2 border-base-content/30 bg-base-100 -ml-[1px]" />
            }
            isLast
          >
            {editing ? (
              <div>
                <div className="text-xs font-medium text-base-content/50 mb-2">Evidence Mapping</div>
                <EvidenceEditor
                  evidence={Array.isArray(activeEvidence) ? activeEvidence : []}
                  availableColumns={finalColumns}
                  onChange={setEvidence}
                />
              </div>
            ) : readOnlyEvidence.length > 0 ? (
              <div className="space-y-1.5">
                {readOnlyEvidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Tag className="size-3.5 text-base-content/30 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">{ev.category}</span>
                      {ev.centric && <span className="text-base-content/50"> · {ev.centric}</span>}
                      <span className="text-base-content/40"> · </span>
                      <span className="font-mono text-xs text-base-content/40">{ev.source_tag}</span>
                      {ev.fields && (
                        <div className="text-xs text-base-content/40 font-mono mt-0.5">
                          {Object.entries(ev.fields).map(([k, v]) => `${k}→${v}`).join("  ")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-base-content/30 italic">No evidence mapping</p>
            )}
          </TimelineNode>
        </div>
      )}

      {!loading && !loadError && !rawTable && (
        <p className="text-sm text-base-content/40 italic py-8 text-center">
          Could not load raw data for preview
        </p>
      )}
    </div>
  );
}

// --- Timeline components ---

function TimelineNode({
  marker,
  children,
  isLast,
}: {
  marker: React.ReactNode;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className={`relative flex gap-3 ${isLast ? "" : "pb-4"}`}>
      {/* Marker positioned on the rail */}
      <div className="absolute -left-8 top-2.5 w-6 flex items-center justify-center">
        {marker}
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// --- Pipeline summary ---

function PipelineSummary({
  rawRowCount,
  transforms,
  pipeline,
  evidence,
}: {
  rawRowCount: number;
  transforms: TransformConfig[];
  pipeline: ReturnType<typeof applyTransformations> | null;
  evidence: { category: string }[];
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap text-xs">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-base-100 text-base-content/60 border border-base-300">
        <Database className="size-3" />
        {rawRowCount}r
      </span>

      {transforms.map((t, i) => {
        const stage = pipeline?.stages[i];
        const rowChanged = stage && (
          i === 0
            ? stage.rowCount !== rawRowCount
            : stage.rowCount !== (pipeline?.stages[i - 1]?.rowCount ?? rawRowCount)
        );
        const colors = getTransformColor(t.type);
        return (
          <span key={i} className="contents">
            <ArrowRight className="size-3 text-base-content/20" />
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${colors.border} ${colors.bg}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
              {t.type}
              {rowChanged && stage && (
                <span className="text-base-content/40">{stage.rowCount}r</span>
              )}
              {stage?.error && <AlertTriangle className="size-3 text-error" />}
            </span>
          </span>
        );
      })}

      {evidence.length > 0 && (
        <>
          <ArrowRight className="size-3 text-base-content/20" />
          {evidence.map((ev, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-base-100 text-base-content/60 border border-base-300">
              <Tag className="size-3" />
              {ev.category}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

// --- Stage block (read-only node content) ---

interface StageBlockProps {
  label: string;
  rowCount: number;
  columnCount: number;
  table: ColumnTable;
  error?: string;
  config?: TransformConfig;
  variant?: "data" | "transform";
  colors?: { dot: string; border: string; bg: string };
}

function StageBlock({
  label,
  rowCount,
  columnCount,
  table,
  error,
  config,
  variant = "transform",
  colors,
}: StageBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const previewRows = useMemo(() => {
    if (!expanded) return [];
    try {
      return table.slice(0, 10).objects() as Record<string, unknown>[];
    } catch {
      return [];
    }
  }, [expanded, table]);

  const columns = table.columnNames();

  const borderClass = error
    ? "border-error/40"
    : variant === "data"
      ? "border-base-300"
      : colors?.border ?? "border-base-300";
  const bgClass = error
    ? "bg-error/5"
    : variant === "data"
      ? "bg-base-100"
      : colors?.bg ?? "bg-base-100";

  return (
    <div className={`rounded-lg border ${borderClass} ${bgClass}`}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3.5 shrink-0 text-base-content/30" /> : <ChevronRight className="size-3.5 shrink-0 text-base-content/30" />}
        <span className="font-medium text-sm">{label}</span>
        {config && formatTransformParams(config) && (
          <span className="text-xs text-base-content/35 font-mono truncate">
            {formatTransformParams(config)}
          </span>
        )}
        <span className="text-xs text-base-content/35 ml-auto tabular-nums shrink-0">
          {rowCount}r x {columnCount}c
        </span>
        {error && <AlertTriangle className="size-3.5 text-error shrink-0" />}
      </button>

      {error && <div className="px-3 pb-2 text-xs text-error">{error}</div>}

      {expanded && previewRows.length > 0 && (
        <div className="overflow-x-auto border-t border-base-300/50">
          <table className="table table-xs">
            <thead>
              <tr className="text-base-content/40">
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap font-medium">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col} className="max-w-48 truncate">
                      {row[col] == null ? (
                        <span className="text-base-content/20">null</span>
                      ) : (
                        String(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

async function loadSourceData(source: V2fSourceConfig): Promise<Record<string, unknown>[]> {
  // Try the imported raw_<name> table first.
  try {
    const safeName = source.name.replace(/[^a-zA-Z0-9_]/g, "");
    const rows = await getDataSource().query<Record<string, unknown>>({
      sql: `SELECT * FROM "raw_${safeName}" LIMIT 200`,
    });
    if (rows.length > 0) return rows;
  } catch { /* not built */ }

  // Fetching from the source URL directly works for plain HTTPS CSVs.
  // Google Sheets preview needs the pipeline runtime (Phase 1c) — skip until then.
  if (source.url && source.source_type !== "googlesheets") {
    const res = await fetch(source.url);
    const text = await res.text();
    return aq.fromCSV(text).objects() as Record<string, unknown>[];
  }

  return [];
}

function formatTransformLabel(config: TransformConfig): string {
  const { type, column } = config;
  if (column) return `${type}(${column})`;
  if (config.columns && typeof config.columns === "object" && !Array.isArray(config.columns)) {
    const entries = Object.entries(config.columns);
    if (entries.length <= 2) return `${type}(${entries.map(([k, v]) => `${k}→${v}`).join(", ")})`;
    return `${type}(${entries.length} cols)`;
  }
  return type;
}

function formatTransformParams(config: TransformConfig): string {
  const parts: string[] = [];
  if (config.pattern) parts.push(`"${config.pattern}"`);
  if (config.prefix) parts.push(`"${config.prefix}"`);
  if (config.delimiter) parts.push(`delim="${config.delimiter}"`);
  if (config.index !== undefined) parts.push(`[${config.index}]`);
  if (config.output) parts.push(`→ ${config.output}`);
  if (config.from && config.to) parts.push(`${config.from}→${config.to}`);
  if (config.drop_unmapped) parts.push("drop_unmapped");
  return parts.join("  ");
}
