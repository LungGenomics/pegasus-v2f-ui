// Per-type form editors for transform DSL steps. The JSON editor stays as
// an "Advanced" escape hatch on each step (in source-workarea); this module
// is the default, friendlier view.
//
// Column inputs use the custom ColumnCombobox (input + capped popup) plus
// free typing — necessary because columns produced by earlier transforms
// (e.g. parse_variant_id makes `chromosome` + `position`) don't appear in
// the raw schema we get passed.
//
// The form components are intentionally controlled+derived: each render
// reads `params` directly and emits the full next params on every change.
// rename / aggregate use a small local entries array to keep row identity
// stable across keystrokes while still emitting the canonical Record shape.

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { ColumnCombobox } from "./column-combobox";

type Params = Record<string, unknown>;

const AGG_FUNCTIONS = [
  "min",
  "max",
  "sum",
  "avg",
  "count",
  "first",
  "last",
  "string_agg",
  "array_agg",
] as const;

// --- Atoms -----------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-medium text-base-content/70 mb-1">
      {children}
    </span>
  );
}

function ColumnListInput({
  value,
  onChange,
  columns,
  itemLabel = "column",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  columns: string[];
  itemLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <ColumnCombobox
            value={v}
            onChange={(nv) =>
              onChange(value.map((x, idx) => (idx === i ? nv : x)))
            }
            columns={columns}
            placeholder={itemLabel}
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-base-content/40 hover:text-error cursor-pointer shrink-0"
            title="Remove"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, ""])}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 cursor-pointer"
      >
        <Plus className="size-3" /> Add {itemLabel}
      </button>
    </div>
  );
}

function StringListInput({
  value,
  onChange,
  placeholder = "value",
  itemLabel = "value",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  itemLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      {value.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={v}
            onChange={(e) =>
              onChange(value.map((x, idx) => (idx === i ? e.target.value : x)))
            }
            placeholder={placeholder}
            className="input input-bordered input-sm w-full font-mono"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-base-content/40 hover:text-error cursor-pointer shrink-0"
            title="Remove"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, ""])}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 cursor-pointer"
      >
        <Plus className="size-3" /> Add {itemLabel}
      </button>
    </div>
  );
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v ? [v] : [];
  return [];
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function asBool(v: unknown): boolean {
  return Boolean(v);
}
function asRecord(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = String(val ?? "");
    }
    return out;
  }
  return {};
}

// --- "Incomplete?" check ---------------------------------------------------
// Mirrors the per-type guards in src/data/transform/compile.ts: a step is
// "incomplete" when compile.ts would short-circuit it (returning the
// upstream input unchanged) — useful so the UI can show those steps as
// no-ops without actually breaking the pipeline. Used by the step card to
// dim the body + render an `incomplete` badge.

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function nonBlankArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter((s) => s !== "");
}

export function isTransformIncomplete(
  type: string,
  params: Record<string, unknown>,
): boolean {
  const p = params ?? {};
  switch (type) {
    case "rename": {
      const cols = (p.columns ?? {}) as Record<string, unknown>;
      if (!cols || typeof cols !== "object" || Array.isArray(cols)) return true;
      // At least one pair with both old + new non-blank.
      return !Object.entries(cols).some(
        ([from, to]) => from.trim() !== "" && String(to ?? "").trim() !== "",
      );
    }
    case "deduplicate":
      // Empty columns is valid — compiles to DISTINCT *.
      return false;
    case "select":
    case "drop_nulls":
    case "coerce_numeric":
      return nonBlankArray(p.columns).length === 0;
    case "strip_prefix":
      return !trimStr(p.column) || !trimStr(p.prefix);
    case "uppercase":
    case "parse_variant_id":
    case "explode_column":
    case "map_gene_id":
      return !trimStr(p.column);
    case "filter_values":
      return !trimStr(p.column) || nonBlankArray(p.values).length === 0;
    case "split_column":
      return !trimStr(p.column) || nonBlankArray(p.columns).length === 0;
    case "aggregate": {
      if (nonBlankArray(p.group_by).length === 0) return true;
      const agg = (p.agg ?? {}) as Record<string, unknown>;
      if (!agg || typeof agg !== "object" || Array.isArray(agg)) return true;
      return !Object.entries(agg).some(
        ([col, fn]) => col.trim() !== "" && String(fn ?? "").trim() !== "",
      );
    }
    case "compute":
      return !trimStr(p.output) || !trimStr(p.expression);
    default:
      // Unknown / custom — don't assume; let it through.
      return false;
  }
}

// --- Pair editor (rename, aggregate) --------------------------------------
// Stores entries as an array internally so row identity is stable across
// keystrokes (Object.entries order is unstable when a key flips to "").
// Emits the canonical Record<string,string> shape on every change.

function PairsEditor({
  value,
  onChange,
  columns,
  rightKind,
  leftPlaceholder,
  rightPlaceholder,
  rightOptions,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  columns: string[];
  rightKind: "text" | "select";
  leftPlaceholder?: string;
  rightPlaceholder?: string;
  rightOptions?: readonly string[];
}) {
  const [entries, setEntries] = useState<Array<{ from: string; to: string }>>(
    () => Object.entries(value).map(([from, to]) => ({ from, to })),
  );
  const propSig = JSON.stringify(value);
  // Re-sync local entries when the source of truth (params) changes from
  // outside (e.g. another component edit, or initial load).
  useEffect(() => {
    setEntries(Object.entries(value).map(([from, to]) => ({ from, to })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propSig]);

  const emit = (next: Array<{ from: string; to: string }>) => {
    setEntries(next);
    const map: Record<string, string> = {};
    for (const { from, to } of next) {
      if (from) map[from] = to;
    }
    onChange(map);
  };
  const setFrom = (i: number, v: string) =>
    emit(entries.map((e, idx) => (idx === i ? { ...e, from: v } : e)));
  const setTo = (i: number, v: string) =>
    emit(entries.map((e, idx) => (idx === i ? { ...e, to: v } : e)));
  const remove = (i: number) => emit(entries.filter((_, idx) => idx !== i));
  const add = () => emit([...entries, { from: "", to: "" }]);

  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-1">
          <ColumnCombobox
            value={e.from}
            onChange={(v) => setFrom(i, v)}
            columns={columns}
            placeholder={leftPlaceholder ?? "column"}
          />
          <span className="text-base-content/40 text-xs shrink-0">→</span>
          {rightKind === "text" ? (
            <input
              value={e.to}
              onChange={(ev) => setTo(i, ev.target.value)}
              placeholder={rightPlaceholder ?? "new"}
              className="input input-bordered input-sm w-full font-mono"
            />
          ) : (
            <select
              value={e.to}
              onChange={(ev) => setTo(i, ev.target.value)}
              className="select select-bordered select-sm w-full"
            >
              <option value="">{rightPlaceholder ?? "fn"}</option>
              {(rightOptions ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-base-content/40 hover:text-error cursor-pointer shrink-0"
            title="Remove"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 cursor-pointer"
      >
        <Plus className="size-3" /> Add
      </button>
    </div>
  );
}

// --- Per-type forms --------------------------------------------------------

function RenameForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div>
      <FieldLabel>Column renames (old → new)</FieldLabel>
      <PairsEditor
        value={asRecord(params.columns)}
        onChange={(map) => onChange({ ...params, columns: map })}
        columns={columns}
        rightKind="text"
        leftPlaceholder="old name"
        rightPlaceholder="new name"
      />
    </div>
  );
}

function ColumnListForm({
  params,
  onChange,
  columns,
  label,
  itemLabel,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
  label: string;
  itemLabel?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <ColumnListInput
        value={asStringArray(params.columns)}
        onChange={(v) => onChange({ ...params, columns: v })}
        columns={columns}
        itemLabel={itemLabel ?? "column"}
      />
    </div>
  );
}

function SingleColumnForm({
  params,
  onChange,
  columns,
  label,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
  label: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <ColumnCombobox
        value={asString(params.column)}
        onChange={(v) => onChange({ ...params, column: v })}
        columns={columns}
      />
    </div>
  );
}

function StripPrefixForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Column</FieldLabel>
        <ColumnCombobox
          value={asString(params.column)}
          onChange={(v) => onChange({ ...params, column: v })}
          columns={columns}
        />
      </div>
      <div>
        <FieldLabel>Prefix to strip</FieldLabel>
        <input
          value={asString(params.prefix)}
          onChange={(e) => onChange({ ...params, prefix: e.target.value })}
          placeholder='e.g. "chr"'
          className="input input-bordered input-sm w-full font-mono"
        />
      </div>
    </div>
  );
}

function FilterValuesForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Column</FieldLabel>
        <ColumnCombobox
          value={asString(params.column)}
          onChange={(v) => onChange({ ...params, column: v })}
          columns={columns}
        />
      </div>
      <div>
        <FieldLabel>Keep rows where column is in</FieldLabel>
        <StringListInput
          value={asStringArray(params.values)}
          onChange={(v) => onChange({ ...params, values: v })}
          placeholder="value"
          itemLabel="value"
        />
      </div>
    </div>
  );
}

function SplitColumnForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Column to split</FieldLabel>
        <ColumnCombobox
          value={asString(params.column)}
          onChange={(v) => onChange({ ...params, column: v })}
          columns={columns}
        />
      </div>
      <div>
        <FieldLabel>Delimiter</FieldLabel>
        <input
          value={asString(params.delimiter)}
          onChange={(e) => onChange({ ...params, delimiter: e.target.value })}
          placeholder='e.g. ","'
          className="input input-bordered input-sm w-full font-mono"
        />
      </div>
      <div>
        <FieldLabel>Output columns (in order)</FieldLabel>
        <StringListInput
          value={asStringArray(params.columns)}
          onChange={(v) => onChange({ ...params, columns: v })}
          placeholder="output_col"
          itemLabel="column"
        />
      </div>
    </div>
  );
}

function ExplodeColumnForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Column to explode</FieldLabel>
        <ColumnCombobox
          value={asString(params.column)}
          onChange={(v) => onChange({ ...params, column: v })}
          columns={columns}
        />
      </div>
      <div>
        <FieldLabel>Delimiter</FieldLabel>
        <input
          value={asString(params.delimiter) || ","}
          onChange={(e) => onChange({ ...params, delimiter: e.target.value })}
          className="input input-bordered input-sm w-full font-mono"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.trim !== false}
          onChange={(e) => onChange({ ...params, trim: e.target.checked })}
          className="checkbox checkbox-xs"
        />
        Trim whitespace from each value
      </label>
    </div>
  );
}

function AggregateForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Group by</FieldLabel>
        <ColumnListInput
          value={asStringArray(params.group_by)}
          onChange={(v) => onChange({ ...params, group_by: v })}
          columns={columns}
          itemLabel="column"
        />
      </div>
      <div>
        <FieldLabel>Aggregations (column → function)</FieldLabel>
        <PairsEditor
          value={asRecord(params.agg)}
          onChange={(m) => onChange({ ...params, agg: m })}
          columns={columns}
          rightKind="select"
          leftPlaceholder="column"
          rightPlaceholder="fn"
          rightOptions={AGG_FUNCTIONS}
        />
      </div>
    </div>
  );
}

function ComputeForm({
  params,
  onChange,
}: {
  params: Params;
  onChange: (p: Params) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Output column name</FieldLabel>
        <input
          value={asString(params.output)}
          onChange={(e) => onChange({ ...params, output: e.target.value })}
          placeholder="new_column"
          className="input input-bordered input-sm w-full font-mono"
        />
      </div>
      <div>
        <FieldLabel>SQL expression</FieldLabel>
        <textarea
          value={asString(params.expression)}
          onChange={(e) =>
            onChange({ ...params, expression: e.target.value })
          }
          placeholder='e.g. "-LOG10(pvalue)"'
          rows={2}
          className="textarea textarea-bordered textarea-sm w-full font-mono text-xs"
        />
      </div>
    </div>
  );
}

function MapGeneIdForm({
  params,
  onChange,
  columns,
}: {
  params: Params;
  onChange: (p: Params) => void;
  columns: string[];
}) {
  // Currently only ensembl → hgnc is wired; lock both ends.
  useEffect(() => {
    const next: Params = { ...params };
    let changed = false;
    if (params.from !== "ensembl") {
      next.from = "ensembl";
      changed = true;
    }
    if (params.to !== "hgnc") {
      next.to = "hgnc";
      changed = true;
    }
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.from, params.to]);

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Column (Ensembl IDs)</FieldLabel>
        <ColumnCombobox
          value={asString(params.column)}
          onChange={(v) => onChange({ ...params, column: v })}
          columns={columns}
        />
      </div>
      <p className="text-xs text-base-content/40">
        Maps Ensembl gene IDs → HGNC symbols (the only direction wired).
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={asBool(params.drop_unmapped)}
          onChange={(e) =>
            onChange({ ...params, drop_unmapped: e.target.checked })
          }
          className="checkbox checkbox-xs"
        />
        Drop rows with unmapped IDs
      </label>
    </div>
  );
}

// --- Dispatch --------------------------------------------------------------

export function TransformParamsEditor({
  type,
  params,
  columns,
  onChange,
}: {
  type: string;
  params: Params;
  columns: string[];
  onChange: (p: Params) => void;
}) {
  switch (type) {
    case "rename":
      return <RenameForm params={params} onChange={onChange} columns={columns} />;
    case "select":
      return (
        <ColumnListForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Keep these columns (in order)"
        />
      );
    case "deduplicate":
      return (
        <ColumnListForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Dedup by columns (empty = DISTINCT *)"
        />
      );
    case "strip_prefix":
      return (
        <StripPrefixForm params={params} onChange={onChange} columns={columns} />
      );
    case "uppercase":
      return (
        <SingleColumnForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Column to uppercase"
        />
      );
    case "drop_nulls":
      return (
        <ColumnListForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Drop rows where any of these are NULL"
        />
      );
    case "coerce_numeric":
      return (
        <ColumnListForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Coerce these columns to numeric (TRY_CAST → DOUBLE)"
        />
      );
    case "filter_values":
      return (
        <FilterValuesForm
          params={params}
          onChange={onChange}
          columns={columns}
        />
      );
    case "parse_variant_id":
      return (
        <SingleColumnForm
          params={params}
          onChange={onChange}
          columns={columns}
          label="Variant ID column (produces chromosome + position)"
        />
      );
    case "split_column":
      return (
        <SplitColumnForm params={params} onChange={onChange} columns={columns} />
      );
    case "explode_column":
      return (
        <ExplodeColumnForm
          params={params}
          onChange={onChange}
          columns={columns}
        />
      );
    case "aggregate":
      return (
        <AggregateForm params={params} onChange={onChange} columns={columns} />
      );
    case "compute":
      return <ComputeForm params={params} onChange={onChange} />;
    case "map_gene_id":
      return (
        <MapGeneIdForm params={params} onChange={onChange} columns={columns} />
      );
    default:
      return (
        <p className="text-xs text-base-content/40">
          No form for "{type}" — switch to Advanced (JSON).
        </p>
      );
  }
}
