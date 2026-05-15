// One derivation, rendered as either a read-only card or an inline
// editor. Used by source-detail.tsx for both existing derivations
// (Edit toggle) and new ones (passed `isNew`).

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { EVIDENCE_CATEGORIES } from "../../data/static";
import { TraitInput } from "../../components/trait-input";
import { SchemaFormProvider } from "../../components/schema-form/context";
import { TransformEditor } from "./transform-editor";
import { TransformPicker } from "./transform-picker";
import { CANONICAL_FIELDS, REQUIRED_FIELDS } from "./add-data-wizard/types";
import type {
  ConfigDerivation,
  ConfigSource,
  DerivationCentric,
  DerivationMapping,
  DerivationRole,
  DerivationTraitColumn,
  DerivationTraitScope,
  DerivationTransform,
  TransformConfigEntry,
} from "../../api/types";

const CATEGORY_OPTIONS = Object.entries(EVIDENCE_CATEGORIES).map(
  ([abbrev, label]) => ({ value: abbrev, label: `${abbrev} — ${label}` }),
);

export type DerivationPatch = {
  source_tag?: string;
  display_name?: string;
  role?: DerivationRole;
  evidence_category?: string;
  centric?: DerivationCentric;
  trait_scope?: DerivationTraitScope;
  mappings?: DerivationMapping[];
  transforms?: DerivationTransform[];
  trait_ids?: string[];
  trait_column?: DerivationTraitColumn | null;
};

interface Props {
  source: ConfigSource;
  rawColumns: string[];
  derivation?: ConfigDerivation;
  isNew?: boolean;
  onSave: (patch: DerivationPatch) => Promise<void>;
  onRemove?: () => Promise<void>;
  onCancel?: () => void;
}

export function DerivationCard({
  source,
  rawColumns,
  derivation,
  isNew = false,
  onSave,
  onRemove,
  onCancel,
}: Props) {
  // Editor open from the start when adding a new derivation; collapsed
  // by default when viewing an existing one.
  const [editing, setEditing] = useState(isNew);
  const [expanded, setExpanded] = useState(isNew);

  if (editing) {
    return (
      <DerivationEditor
        source={source}
        rawColumns={rawColumns}
        derivation={derivation}
        isNew={isNew}
        onSave={async (patch) => {
          await onSave(patch);
          if (!isNew) setEditing(false);
        }}
        onCancel={() => {
          if (isNew && onCancel) onCancel();
          else setEditing(false);
        }}
      />
    );
  }

  if (!derivation) return null;

  return (
    <div className="border border-base-300 rounded-lg bg-base-100">
      <div className="flex items-center">
        <button
          type="button"
          className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-base-200/40 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 text-base-content/30 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-base-content/30 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                {derivation.display_name ??
                  `${derivation.evidence_category} evidence`}
              </span>
              <span className="badge badge-xs badge-outline">
                {derivation.evidence_category}
              </span>
              {derivation.role === "loci_definition" && (
                <span className="badge badge-xs badge-warning">loci</span>
              )}
              <span className="text-[10px] text-base-content/40 uppercase">
                {derivation.centric}-centric
              </span>
            </div>
            <div className="text-xs text-base-content/50 mt-0.5">
              <code className="font-mono">{derivation.source_tag}</code>
              <span className="ml-2">
                {derivation.trait_scope === "constant"
                  ? `${derivation.trait_ids?.length ?? 0} constant trait${
                      derivation.trait_ids?.length === 1 ? "" : "s"
                    }`
                  : `per-row from ${derivation.trait_column?.raw_column ?? "?"}`}
              </span>
              <span className="ml-2">
                {derivation.mappings?.length ?? 0} mappings
              </span>
              <span className="ml-2">
                {derivation.transforms?.length ?? 0} transforms
              </span>
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1 pr-3 shrink-0">
          <button
            type="button"
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3" />
            Edit
          </button>
          {onRemove && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error gap-1"
              title="Remove derivation"
              onClick={() => void onRemove()}
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-base-300 px-4 py-3 text-xs text-base-content/60 space-y-2">
          <DerivationSummary derivation={derivation} />
        </div>
      )}
    </div>
  );
}

// --- Read-only summary inside the expanded card ---

function DerivationSummary({ derivation }: { derivation: ConfigDerivation }) {
  return (
    <>
      {derivation.mappings && derivation.mappings.length > 0 && (
        <div>
          <div className="font-medium text-base-content/50 mb-1">
            Column mappings
          </div>
          <div className="grid grid-cols-2 gap-x-4 font-mono text-[11px]">
            {derivation.mappings.map((m) => (
              <div key={m.canonical_field} className="flex gap-2">
                <span className="text-base-content/50">{m.canonical_field}</span>
                <span>←</span>
                <span>{m.raw_column}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {derivation.transforms && derivation.transforms.length > 0 && (
        <div>
          <div className="font-medium text-base-content/50 mb-1">Transforms</div>
          <ol className="space-y-0.5 font-mono text-[11px]">
            {derivation.transforms.map((t) => (
              <li key={t.seq}>
                {t.seq + 1}. {t.type}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

// --- Inline editor ---

function DerivationEditor({
  source,
  rawColumns,
  derivation,
  isNew,
  onSave,
  onCancel,
}: {
  source: ConfigSource;
  rawColumns: string[];
  derivation?: ConfigDerivation;
  isNew: boolean;
  onSave: (patch: DerivationPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(derivation?.display_name ?? "");
  const [category, setCategory] = useState(
    derivation?.evidence_category ?? "GWAS",
  );
  const [role, setRole] = useState<DerivationRole>(
    derivation?.role ?? "evidence",
  );
  const [centric, setCentric] = useState<DerivationCentric>(
    derivation?.centric ?? "variant",
  );
  const [traitScope, setTraitScope] = useState<DerivationTraitScope>(
    derivation?.trait_scope ?? "constant",
  );
  const [traitIds, setTraitIds] = useState<string[]>(
    derivation?.trait_ids ?? source.trait_ids ?? [],
  );
  const [traitColumn, setTraitColumn] = useState(
    derivation?.trait_column?.raw_column ?? "",
  );
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const x of derivation?.mappings ?? []) {
      m[x.canonical_field] = x.raw_column;
    }
    return m;
  });
  const [transforms, setTransforms] = useState<TransformConfigEntry[]>(
    () =>
      (derivation?.transforms ?? []).map((t) => ({
        type: t.type,
        ...(t.params ?? {}),
      })) as TransformConfigEntry[],
  );

  const sourceTag = useMemo(
    () => derivation?.source_tag ?? `${source.name}__${category}`,
    [derivation, source.name, category],
  );

  const canSubmit =
    Boolean(mappings["gene_symbol"]) &&
    (traitScope === "constant" ? traitIds.length > 0 : traitColumn.length > 0);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const mapList: DerivationMapping[] = Object.entries(mappings)
        .filter(([, raw]) => Boolean(raw))
        .map(([canonical_field, raw_column]) => ({ canonical_field, raw_column }));
      const transformsList: DerivationTransform[] = transforms.map((t, i) => {
        const { type, ...params } = t;
        return { seq: i, type, params: params as Record<string, unknown> };
      });
      const patch: DerivationPatch = {
        source_tag: sourceTag,
        display_name: displayName || undefined,
        role,
        evidence_category: category,
        centric,
        trait_scope: traitScope,
        mappings: mapList,
        transforms: transformsList,
      };
      if (traitScope === "constant") {
        patch.trait_ids = traitIds;
        patch.trait_column = null;
      } else {
        patch.trait_column = { raw_column: traitColumn };
        patch.trait_ids = [];
      }
      await onSave(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-primary/30 rounded-lg bg-base-100 p-4 space-y-4">
      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wider">
        {isNew ? "New derivation" : "Editing derivation"}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Display name</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`${category} evidence`}
          />
        </div>
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Source tag</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm w-full font-mono"
            value={sourceTag}
            disabled
          />
        </div>
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Evidence category *</span>
          </label>
          <select
            className="select select-bordered select-sm w-full"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Centric *</span>
          </label>
          <div className="flex gap-3 pt-1">
            <label className="cursor-pointer flex items-center gap-1.5">
              <input
                type="radio"
                className="radio radio-xs"
                checked={centric === "variant"}
                onChange={() => setCentric("variant")}
              />
              <span className="text-sm">variant</span>
            </label>
            <label className="cursor-pointer flex items-center gap-1.5">
              <input
                type="radio"
                className="radio radio-xs"
                checked={centric === "gene"}
                onChange={() => setCentric("gene")}
              />
              <span className="text-sm">gene</span>
            </label>
          </div>
        </div>
      </div>

      <div className="form-control">
        <label className="cursor-pointer flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={role === "loci_definition"}
            onChange={(e) =>
              setRole(e.target.checked ? "loci_definition" : "evidence")
            }
          />
          <span className="text-sm">This derivation defines loci/sentinels</span>
        </label>
      </div>

      {/* Trait scope */}
      <div>
        <div className="text-sm font-medium mb-2">Trait coverage *</div>
        <div className="flex gap-3 mb-2">
          <label className="cursor-pointer flex items-center gap-1.5">
            <input
              type="radio"
              className="radio radio-xs"
              checked={traitScope === "constant"}
              onChange={() => setTraitScope("constant")}
            />
            <span className="text-sm">constant</span>
          </label>
          <label className="cursor-pointer flex items-center gap-1.5">
            <input
              type="radio"
              className="radio radio-xs"
              checked={traitScope === "column"}
              onChange={() => setTraitScope("column")}
            />
            <span className="text-sm">per-row column</span>
          </label>
        </div>
        {traitScope === "constant" ? (
          <TraitInput value={traitIds} onChange={setTraitIds} multiple />
        ) : (
          <select
            className="select select-bordered select-sm w-full"
            value={traitColumn}
            onChange={(e) => setTraitColumn(e.target.value)}
          >
            <option value="">— pick a column —</option>
            {rawColumns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Mappings */}
      <div>
        <div className="text-sm font-medium mb-2">Column mappings *</div>
        {rawColumns.length === 0 && (
          <div className="text-xs text-base-content/40 italic mb-2">
            No raw columns yet — build the source first to populate this list,
            or type column names manually.
          </div>
        )}
        <div className="border border-base-300 rounded-lg overflow-hidden">
          <table className="table table-xs">
            <tbody>
              {CANONICAL_FIELDS.map((field) => (
                <tr key={field}>
                  <td className="font-mono text-xs w-40">
                    {field}
                    {REQUIRED_FIELDS.has(field) && (
                      <span className="text-error ml-0.5">*</span>
                    )}
                  </td>
                  <td>
                    {rawColumns.length > 0 ? (
                      <select
                        className="select select-bordered select-xs w-full"
                        value={mappings[field] ?? ""}
                        onChange={(e) =>
                          setMappings((prev) => {
                            const next = { ...prev };
                            if (e.target.value) next[field] = e.target.value;
                            else delete next[field];
                            return next;
                          })
                        }
                      >
                        <option value="">— none —</option>
                        {rawColumns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="input input-bordered input-xs w-full font-mono"
                        value={mappings[field] ?? ""}
                        placeholder="raw column name"
                        onChange={(e) =>
                          setMappings((prev) => {
                            const next = { ...prev };
                            if (e.target.value) next[field] = e.target.value;
                            else delete next[field];
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transforms */}
      <div>
        <div className="text-sm font-medium mb-2">
          Transforms ({transforms.length})
        </div>
        <SchemaFormProvider columns={rawColumns}>
          <div className="space-y-2">
            {transforms.map((t, i) => (
              <div
                key={i}
                className="border border-base-300 rounded-lg bg-base-100"
              >
                <TransformEditor
                  config={t}
                  availableColumns={rawColumns}
                  onChange={(updated) => {
                    const next = [...transforms];
                    next[i] = updated;
                    setTransforms(next);
                  }}
                  onRemove={() =>
                    setTransforms(transforms.filter((_, j) => j !== i))
                  }
                  onMoveUp={() => {
                    if (i === 0) return;
                    const next = [...transforms];
                    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                    setTransforms(next);
                  }}
                  onMoveDown={() => {
                    if (i === transforms.length - 1) return;
                    const next = [...transforms];
                    [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                    setTransforms(next);
                  }}
                  isFirst={i === 0}
                  isLast={i === transforms.length - 1}
                />
              </div>
            ))}
            <div className="border border-dashed border-base-300 rounded-lg px-3 py-2">
              <TransformPicker
                onAdd={(t) => setTransforms([...transforms, t])}
              />
            </div>
          </div>
        </SchemaFormProvider>
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1"
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          {isNew ? "Add derivation" : "Save"}
        </button>
      </div>
    </div>
  );
}
