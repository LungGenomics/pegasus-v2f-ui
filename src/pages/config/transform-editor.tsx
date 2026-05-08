import { useState, useMemo } from "react";
import { type ColumnTable } from "arquero";
import { ArrowUp, ArrowDown, Trash2, Plus, X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { TransformConfigEntry } from "../../api/types";

export interface StagePreview {
  rowCount: number;
  columnNames: string[];
  table: ColumnTable;
  error?: string;
}

interface Props {
  config: TransformConfigEntry;
  availableColumns: string[];
  preview?: StagePreview;
  onChange: (config: TransformConfigEntry) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function TransformEditor({
  config,
  availableColumns,
  preview,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: Props) {
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const previewRows = useMemo(() => {
    if (!previewExpanded || !preview) return [];
    try {
      return preview.table.slice(0, 10).objects() as Record<string, unknown>[];
    } catch {
      return [];
    }
  }, [previewExpanded, preview]);

  return (
    <div>
      {/* Header: type + row counts + controls */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <span className="font-medium text-sm flex-1">{config.type}</span>
        {preview && (
          <span className="text-xs text-base-content/35 tabular-nums">
            {preview.rowCount}r x {preview.columnNames.length}c
          </span>
        )}
        {preview?.error && <AlertTriangle className="size-3.5 text-error shrink-0" />}
        <div className="flex items-center gap-0.5">
          <button className="btn btn-ghost btn-xs" onClick={onMoveUp} disabled={isFirst} title="Move up">
            <ArrowUp className="size-3.5" />
          </button>
          <button className="btn btn-ghost btn-xs" onClick={onMoveDown} disabled={isLast} title="Move down">
            <ArrowDown className="size-3.5" />
          </button>
          <button className="btn btn-ghost btn-xs text-error/60 hover:text-error" onClick={onRemove} title="Remove">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {preview?.error && (
        <div className="px-3 pb-1 text-xs text-error">{preview.error}</div>
      )}

      {/* Fields */}
      <div className="px-3 pb-2.5 pt-1">
        <TransformFields config={config} columns={availableColumns} onChange={onChange} />
      </div>

      {/* Inline data preview */}
      {preview && (
        <div className="border-t border-black/5">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-black/[0.02] transition-colors text-xs text-base-content/40"
            onClick={() => setPreviewExpanded(!previewExpanded)}
          >
            {previewExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Preview
          </button>
          {previewExpanded && previewRows.length > 0 && (
            <div className="overflow-x-auto border-t border-black/5">
              <table className="table table-xs">
                <thead>
                  <tr className="text-base-content/40">
                    {preview.columnNames.map((col) => (
                      <th key={col} className="whitespace-nowrap font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {preview.columnNames.map((col) => (
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
      )}
    </div>
  );
}

// --- Dynamic fields per transform type ---

function TransformFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  switch (config.type) {
    case "rename":
      return <RenameFields config={config} columns={columns} onChange={onChange} />;
    case "select":
      return <SelectFields config={config} columns={columns} onChange={onChange} />;
    case "filter_values":
      return <FilterValuesFields config={config} columns={columns} onChange={onChange} />;
    case "strip_prefix":
      return <StripPrefixFields config={config} columns={columns} onChange={onChange} />;
    case "split_column":
      return <SplitColumnFields config={config} columns={columns} onChange={onChange} />;
    case "aggregate":
      return <AggregateFields config={config} columns={columns} onChange={onChange} />;
    case "compute":
      return <ComputeFields config={config} onChange={onChange} />;
    case "map_gene_id":
      return <MapGeneIdFields config={config} columns={columns} onChange={onChange} />;
    case "coerce_numeric":
    case "drop_nulls":
    case "uppercase":
    case "deduplicate":
    case "parse_variant_id":
      return <SingleColumnField config={config} columns={columns} onChange={onChange} />;
    default:
      return <p className="text-xs text-base-content/40 italic">No editor for type: {config.type}</p>;
  }
}

// --- Shared column select ---

function ColumnSelect({
  value,
  columns,
  onChange,
  label,
}: {
  value: string | undefined;
  columns: string[];
  onChange: (col: string) => void;
  label?: string;
}) {
  return (
    <label className="form-control w-full">
      {label && (
        <div className="label py-0.5">
          <span className="label-text text-xs">{label}</span>
        </div>
      )}
      <select
        className="select select-bordered select-xs w-full"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select column...</option>
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

// --- Per-type field components ---

function SingleColumnField({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <ColumnSelect
      value={config.column}
      columns={columns}
      label="Column"
      onChange={(column) => onChange({ ...config, column })}
    />
  );
}

function RenameFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  const mapping = (config.columns ?? {}) as Record<string, string>;
  const entries = Object.entries(mapping);

  const updateEntry = (oldKey: string, newKey: string, newVal: string) => {
    const updated = { ...mapping };
    if (oldKey !== newKey) delete updated[oldKey];
    updated[newKey] = newVal;
    onChange({ ...config, columns: updated });
  };

  const removeEntry = (key: string) => {
    const updated = { ...mapping };
    delete updated[key];
    onChange({ ...config, columns: updated });
  };

  const addEntry = () => {
    const unused = columns.find((c) => !(c in mapping));
    onChange({ ...config, columns: { ...mapping, [unused ?? ""]: "" } });
  };

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-base-content/50">Column mappings</span>
      {entries.map(([from, to], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            className="select select-bordered select-xs flex-1"
            value={from}
            onChange={(e) => updateEntry(from, e.target.value, to)}
          >
            <option value="">From...</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-base-content/30">→</span>
          <input
            className="input input-bordered input-xs flex-1"
            value={to}
            placeholder="New name"
            onChange={(e) => updateEntry(from, from, e.target.value)}
          />
          <button className="btn btn-ghost btn-xs" onClick={() => removeEntry(from)}>
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button className="btn btn-ghost btn-xs gap-1" onClick={addEntry}>
        <Plus className="size-3" /> Add mapping
      </button>
    </div>
  );
}

function SelectFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  const selected = Array.isArray(config.columns)
    ? (config.columns as string[])
    : typeof config.columns === "string"
      ? [config.columns]
      : [];

  const toggle = (col: string) => {
    const next = selected.includes(col)
      ? selected.filter((c) => c !== col)
      : [...selected, col];
    onChange({ ...config, columns: next });
  };

  return (
    <div>
      <span className="text-xs text-base-content/50">Keep columns</span>
      <div className="flex flex-wrap gap-1 mt-1">
        {columns.map((c) => (
          <button
            key={c}
            className={`badge badge-sm cursor-pointer ${
              selected.includes(c) ? "badge-primary" : "badge-ghost"
            }`}
            onClick={() => toggle(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterValuesFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ColumnSelect
        value={config.column}
        columns={columns}
        label="Column"
        onChange={(column) => onChange({ ...config, column })}
      />
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Pattern (regex)</span>
        </div>
        <input
          className="input input-bordered input-xs w-full font-mono"
          value={config.pattern ?? ""}
          placeholder="^[A-Za-z]"
          onChange={(e) => onChange({ ...config, pattern: e.target.value })}
        />
      </label>
    </div>
  );
}

function StripPrefixFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ColumnSelect
        value={config.column}
        columns={columns}
        label="Column"
        onChange={(column) => onChange({ ...config, column })}
      />
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Prefix</span>
        </div>
        <input
          className="input input-bordered input-xs w-full"
          value={config.prefix ?? ""}
          placeholder="chr"
          onChange={(e) => onChange({ ...config, prefix: e.target.value })}
        />
      </label>
    </div>
  );
}

function SplitColumnFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ColumnSelect
        value={config.column}
        columns={columns}
        label="Column"
        onChange={(column) => onChange({ ...config, column })}
      />
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Delimiter</span>
        </div>
        <input
          className="input input-bordered input-xs w-full"
          value={config.delimiter ?? "_"}
          onChange={(e) => onChange({ ...config, delimiter: e.target.value })}
        />
      </label>
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Index (0-based)</span>
        </div>
        <input
          type="number"
          className="input input-bordered input-xs w-full"
          value={config.index ?? 0}
          min={0}
          onChange={(e) => onChange({ ...config, index: parseInt(e.target.value) || 0 })}
        />
      </label>
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Output column</span>
        </div>
        <input
          className="input input-bordered input-xs w-full"
          value={config.output ?? ""}
          placeholder="(overwrites source)"
          onChange={(e) => onChange({ ...config, output: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}

function AggregateFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  const groupBy = Array.isArray(config.group_by)
    ? config.group_by
    : config.group_by
      ? [config.group_by]
      : [];
  const agg = (config.agg ?? {}) as Record<string, string>;
  const aggFns = ["min", "max", "mean", "sum", "count", "first"];

  const toggleGroupBy = (col: string) => {
    const next = groupBy.includes(col)
      ? groupBy.filter((c) => c !== col)
      : [...groupBy, col];
    onChange({ ...config, group_by: next });
  };

  const updateAgg = (col: string, fn: string) => {
    onChange({ ...config, agg: { ...agg, [col]: fn } });
  };

  const removeAgg = (col: string) => {
    const updated = { ...agg };
    delete updated[col];
    onChange({ ...config, agg: updated });
  };

  const addAgg = () => {
    const unused = columns.find((c) => !(c in agg) && !groupBy.includes(c));
    if (unused) onChange({ ...config, agg: { ...agg, [unused]: "first" } });
  };

  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs text-base-content/50">Group by</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {columns.map((c) => (
            <button
              key={c}
              className={`badge badge-sm cursor-pointer ${
                groupBy.includes(c) ? "badge-primary" : "badge-ghost"
              }`}
              onClick={() => toggleGroupBy(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-base-content/50">Aggregations</span>
        {Object.entries(agg).map(([col, fn]) => (
          <div key={col} className="flex items-center gap-1.5">
            <select
              className="select select-bordered select-xs flex-1"
              value={col}
              onChange={(e) => {
                const updated = { ...agg };
                delete updated[col];
                updated[e.target.value] = fn;
                onChange({ ...config, agg: updated });
              }}
            >
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              className="select select-bordered select-xs"
              value={fn}
              onChange={(e) => updateAgg(col, e.target.value)}
            >
              {aggFns.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-xs" onClick={() => removeAgg(col)}>
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost btn-xs gap-1" onClick={addAgg}>
          <Plus className="size-3" /> Add aggregation
        </button>
      </div>
    </div>
  );
}

function ComputeFields({
  config,
  onChange,
}: {
  config: TransformConfigEntry;
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Output column</span>
        </div>
        <input
          className="input input-bordered input-xs w-full"
          value={config.output ?? ""}
          placeholder="new_col"
          onChange={(e) => onChange({ ...config, output: e.target.value })}
        />
      </label>
      <label className="form-control w-full">
        <div className="label py-0.5">
          <span className="label-text text-xs">Expression</span>
        </div>
        <input
          className="input input-bordered input-xs w-full font-mono"
          value={config.expression ?? ""}
          placeholder="col_a / col_b"
          onChange={(e) => onChange({ ...config, expression: e.target.value })}
        />
      </label>
    </div>
  );
}

function MapGeneIdFields({
  config,
  columns,
  onChange,
}: {
  config: TransformConfigEntry;
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <ColumnSelect
          value={config.column}
          columns={columns}
          label="Column"
          onChange={(column) => onChange({ ...config, column })}
        />
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">From</span>
          </div>
          <select
            className="select select-bordered select-xs w-full"
            value={config.from ?? "ensembl"}
            onChange={(e) => onChange({ ...config, from: e.target.value })}
          >
            <option value="ensembl">Ensembl</option>
          </select>
        </label>
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">To</span>
          </div>
          <select
            className="select select-bordered select-xs w-full"
            value={config.to ?? "hgnc"}
            onChange={(e) => onChange({ ...config, to: e.target.value })}
          >
            <option value="hgnc">HGNC</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="checkbox checkbox-xs"
          checked={config.drop_unmapped ?? false}
          onChange={(e) => onChange({ ...config, drop_unmapped: e.target.checked })}
        />
        <span className="text-xs">Drop unmapped rows</span>
      </label>
    </div>
  );
}
