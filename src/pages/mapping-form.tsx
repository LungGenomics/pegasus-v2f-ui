// Form editor for one mapping card. A mapping projects a (cleaned) source
// into one output stream: target='evidence' (canonical evidence rows) or
// target='loci' (per-mapping loci resolution). The fields editor pairs a
// canonical evidence column with a transformed raw column.
//
// Column inputs use a combobox + free typing because the transformed schema
// is fetched async and a user may want to type ahead of it. Constant traits
// are picked by label (TraitPicker) — UUIDs are stored, labels are shown.

import { useRef, useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { CANONICAL_FIELDS, REQUIRED_FIELDS } from "../data/canonicalFields";
import { EVIDENCE_CATEGORIES } from "../data/static";
import { ColumnCombobox } from "./column-combobox";
import type {
  ConfigMapping,
  ConfigTrait,
  MappingCentric,
  MappingField,
  MappingTarget,
  MappingTraitScope,
} from "../api/types";

// --- Atoms -----------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-medium text-base-content/70 mb-1">
      {children}
    </span>
  );
}

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-base-200 rounded-md p-0.5 text-xs">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 rounded-md transition-colors capitalize cursor-pointer ${
            value === opt
              ? "bg-base-100 text-base-content font-medium shadow-sm"
              : "text-base-content/60 hover:text-base-content"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// True when a typed column won't be found in the post-transform schema —
// a silent-null risk worth flagging. Only meaningful once the schema is
// known (transformedColumns non-empty), else we'd warn on everything while
// the schema is still loading / the raw table isn't ingested yet.
function isUnknownColumn(col: string, transformedColumns: string[]): boolean {
  const c = col.trim();
  return (
    c !== "" &&
    transformedColumns.length > 0 &&
    !transformedColumns.includes(c)
  );
}

// --- Fields editor (canonical_field × raw_column rows) --------------------

function FieldsEditor({
  value,
  onChange,
  transformedColumns,
}: {
  value: MappingField[];
  onChange: (v: MappingField[]) => void;
  transformedColumns: string[];
}) {
  const hasGeneSymbol = value.some((f) => f.canonical_field === "gene_symbol");
  const anyUnknown = value.some((f) =>
    isUnknownColumn(f.raw_column, transformedColumns),
  );
  // Canonical fields not yet used — the next-add picker defaults to the
  // first unused one so users don't repeatedly add `gene_symbol` rows.
  const used = new Set(value.map((f) => f.canonical_field));
  const firstUnused =
    CANONICAL_FIELDS.find((c) => !used.has(c)) ?? CANONICAL_FIELDS[0]!;

  const update = (i: number, patch: Partial<MappingField>) =>
    onChange(value.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i: number) =>
    onChange(value.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...value, { canonical_field: firstUnused, raw_column: "" }]);

  return (
    <div className="space-y-1.5">
      {value.length === 0 ? (
        <p className="text-xs text-base-content/40">
          No fields yet — add at least <span className="font-mono">gene_symbol</span>.
        </p>
      ) : (
        value.map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <select
              value={f.canonical_field}
              onChange={(e) =>
                update(i, { canonical_field: e.target.value })
              }
              className="select select-bordered select-sm font-mono w-[40%]"
            >
              {CANONICAL_FIELDS.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {REQUIRED_FIELDS.has(c) ? " *" : ""}
                </option>
              ))}
            </select>
            <ColumnCombobox
              value={f.raw_column}
              onChange={(v) => update(i, { raw_column: v })}
              columns={transformedColumns}
              placeholder="column"
              invalid={isUnknownColumn(f.raw_column, transformedColumns)}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-base-content/40 hover:text-error cursor-pointer shrink-0"
              title="Remove field"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 cursor-pointer"
      >
        <Plus className="size-3" />
        Add field
      </button>
      {!hasGeneSymbol && value.length > 0 && (
        <p className="text-xs text-warning">
          Missing required <span className="font-mono">gene_symbol</span>.
        </p>
      )}
      {anyUnknown && (
        <p className="text-xs text-warning">
          A mapped column isn’t in the transformed schema — it’ll project as
          nulls. Check transforms or the column name.
        </p>
      )}
    </div>
  );
}

// --- Trait picker (constant trait_scope) ----------------------------------
// Stores trait UUIDs in `value`, but the user works in labels: selected
// traits show as removable chips, and an autocomplete adds by label. Typing a
// label that doesn't exist offers an inline "Create" that calls onCreateTrait
// (findOrCreateByLabel) and selects the new id. Traits the picker can't
// resolve to a label (e.g. id from another DB) still render with a short id
// so they can be removed.

function TraitPicker({
  value,
  onChange,
  traits,
  onCreateTrait,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  traits: ConfigTrait[];
  onCreateTrait: (label: string) => Promise<string>;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const labelFor = (id: string) =>
    traits.find((t) => t.id === id)?.label ?? `${id.slice(0, 8)}…`;

  const q = query.trim().toLowerCase();
  const selected = new Set(value);
  const suggestions = traits
    .filter((t) => !selected.has(t.id))
    .filter((t) => (q ? t.label.toLowerCase().includes(q) : true))
    .slice(0, 50);
  // Offer create only when the typed label has no exact (case-insensitive)
  // match anywhere — selected or not.
  const exact = traits.some((t) => t.label.toLowerCase() === q);
  const canCreate = q.length > 0 && !exact;

  const addId = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
    setQuery("");
    setOpen(false);
  };
  const removeId = (id: string) => onChange(value.filter((x) => x !== id));
  const create = async () => {
    const label = query.trim();
    if (!label || creating) return;
    setCreating(true);
    try {
      const id = await onCreateTrait(label);
      addId(id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 bg-base-200 rounded-md pl-2 pr-1 py-0.5 text-xs"
            >
              {labelFor(id)}
              <button
                type="button"
                onClick={() => removeId(id)}
                className="text-base-content/40 hover:text-error cursor-pointer"
                title="Remove trait"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div ref={wrapRef} className="relative w-full min-w-0">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="search or add a trait…"
          className="input input-bordered input-sm w-full"
        />
        {open && (suggestions.length > 0 || canCreate) && (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-auto border border-base-300 rounded-md bg-base-100 shadow-md text-xs">
            {suggestions.map((t) => (
              <li
                key={t.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addId(t.id);
                }}
                className="px-2 py-1 cursor-pointer hover:bg-base-200"
              >
                {t.label}
              </li>
            ))}
            {canCreate && (
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  void create();
                }}
                className="px-2 py-1 cursor-pointer hover:bg-base-200 text-primary border-t border-base-300"
              >
                {creating ? "Creating…" : `Create trait “${query.trim()}”`}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Card form ------------------------------------------------------------

/** Tri-state trait scope including "none" for the UI — maps to undefined
 *  on the persisted mapping (trait_scope is optional). */
type TraitScopeUI = "none" | MappingTraitScope;
const TRAIT_SCOPES: readonly TraitScopeUI[] = [
  "none",
  "constant",
  "column",
] as const;

const TARGETS: readonly MappingTarget[] = ["evidence", "loci"] as const;
const CENTRICS: readonly MappingCentric[] = ["variant", "gene"] as const;

export function MappingCardForm({
  draft,
  onChange,
  transformedColumns,
  traits,
  onCreateTrait,
}: {
  draft: ConfigMapping;
  onChange: (patch: Partial<ConfigMapping>) => void;
  transformedColumns: string[];
  traits: ConfigTrait[];
  onCreateTrait: (label: string) => Promise<string>;
}) {
  const target = draft.target;
  const traitScopeUI: TraitScopeUI = draft.trait_scope ?? "none";

  const setTarget = (t: MappingTarget) => {
    // Clear the irrelevant sub-fields so we don't carry over stale loci
    // numbers into an evidence mapping (or vice versa). The user can re-enter
    // them; otherwise we'd save no-op fields the schema doesn't need.
    if (t === "evidence") {
      onChange({
        target: t,
        window_kb: undefined,
        merge_distance_kb: undefined,
      });
    } else {
      onChange({
        target: t,
        evidence_category: undefined,
        centric: undefined,
        trait_scope: undefined,
        trait_ids: undefined,
        trait_column: undefined,
      });
    }
  };

  const setTraitScope = (s: TraitScopeUI) => {
    if (s === "none") {
      onChange({
        trait_scope: undefined,
        trait_ids: undefined,
        trait_column: undefined,
      });
    } else if (s === "constant") {
      onChange({
        trait_scope: "constant",
        trait_column: undefined,
      });
    } else {
      onChange({
        trait_scope: "column",
        trait_ids: undefined,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>Target</FieldLabel>
        <SegmentedToggle
          value={target}
          options={TARGETS}
          onChange={setTarget}
        />
      </div>

      <label className="block">
        <FieldLabel>Display name</FieldLabel>
        <input
          value={draft.display_name ?? ""}
          onChange={(e) =>
            onChange({ display_name: e.target.value || undefined })
          }
          placeholder="optional label"
          className="input input-bordered input-sm w-full"
        />
      </label>

      <label className="block">
        <FieldLabel>
          Source tag <span className="text-base-content/40">(unique)</span>
        </FieldLabel>
        <input
          value={draft.source_tag}
          onChange={(e) => onChange({ source_tag: e.target.value })}
          placeholder="my_source_evidence"
          className="input input-bordered input-sm font-mono w-full"
        />
      </label>

      {target === "evidence" ? (
        <>
          <label className="block">
            <FieldLabel>Evidence category</FieldLabel>
            <select
              value={draft.evidence_category ?? ""}
              onChange={(e) =>
                onChange({
                  evidence_category: e.target.value || undefined,
                })
              }
              // PEGASUS controlled vocab — codes mirror EVIDENCE_CATEGORIES in
              // cli/src/pegasus_v2f/pegasus_schema.py. The full labels (e.g.
              // "QTL — Molecular QTL") aren't shown here; a glossary on the
              // landing page is a future TODO.
              title={
                draft.evidence_category
                  ? EVIDENCE_CATEGORIES[draft.evidence_category]
                  : "Pick a PEGASUS evidence category"
              }
              className="select select-bordered select-sm font-mono w-full"
            >
              <option value="">— pick a category —</option>
              {Object.keys(EVIDENCE_CATEGORIES).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <div>
            <FieldLabel>Centric</FieldLabel>
            <SegmentedToggle
              value={draft.centric ?? "variant"}
              options={CENTRICS}
              onChange={(c) => onChange({ centric: c })}
            />
          </div>

          <div>
            <FieldLabel>Trait scope</FieldLabel>
            <SegmentedToggle
              value={traitScopeUI}
              options={TRAIT_SCOPES}
              onChange={setTraitScope}
            />
          </div>

          {traitScopeUI === "constant" && (
            <div>
              <FieldLabel>Traits</FieldLabel>
              <TraitPicker
                value={draft.trait_ids ?? []}
                onChange={(v) =>
                  onChange({ trait_ids: v.length > 0 ? v : undefined })
                }
                traits={traits}
                onCreateTrait={onCreateTrait}
              />
            </div>
          )}

          {traitScopeUI === "column" && (
            <div className="space-y-2">
              <div>
                <FieldLabel>Trait column</FieldLabel>
                <ColumnCombobox
                  value={draft.trait_column?.raw_column ?? ""}
                  onChange={(raw) =>
                    onChange({
                      trait_column: raw
                        ? {
                            raw_column: raw,
                            ...(draft.trait_column?.trait_id_lookup
                              ? {
                                  trait_id_lookup:
                                    draft.trait_column.trait_id_lookup,
                                }
                              : {}),
                          }
                        : undefined,
                    })
                  }
                  columns={transformedColumns}
                  placeholder="column with trait label"
                  invalid={isUnknownColumn(
                    draft.trait_column?.raw_column ?? "",
                    transformedColumns,
                  )}
                />
              </div>
              <div>
                <FieldLabel>
                  Trait ID lookup{" "}
                  <span className="text-base-content/40">(optional)</span>
                </FieldLabel>
                <ColumnCombobox
                  value={draft.trait_column?.trait_id_lookup ?? ""}
                  onChange={(lookup) =>
                    onChange({
                      trait_column: draft.trait_column?.raw_column
                        ? {
                            raw_column: draft.trait_column.raw_column,
                            ...(lookup ? { trait_id_lookup: lookup } : {}),
                          }
                        : draft.trait_column,
                    })
                  }
                  columns={transformedColumns}
                  placeholder="column with trait ID"
                  invalid={isUnknownColumn(
                    draft.trait_column?.trait_id_lookup ?? "",
                    transformedColumns,
                  )}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="block">
            <FieldLabel>
              Window (kb){" "}
              <span className="text-base-content/40">(optional)</span>
            </FieldLabel>
            <input
              type="number"
              value={draft.window_kb ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  window_kb: v === "" ? undefined : Number(v),
                });
              }}
              placeholder="defaults from pegasus_settings"
              className="input input-bordered input-sm font-mono w-full"
            />
          </label>
          <label className="block">
            <FieldLabel>
              Merge distance (kb){" "}
              <span className="text-base-content/40">(optional)</span>
            </FieldLabel>
            <input
              type="number"
              value={draft.merge_distance_kb ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  merge_distance_kb: v === "" ? undefined : Number(v),
                });
              }}
              placeholder="defaults from pegasus_settings"
              className="input input-bordered input-sm font-mono w-full"
            />
          </label>
        </>
      )}

      <div>
        <FieldLabel>Fields</FieldLabel>
        <FieldsEditor
          value={draft.fields ?? []}
          onChange={(v) =>
            onChange({ fields: v.length > 0 ? v : undefined })
          }
          transformedColumns={transformedColumns}
        />
      </div>
    </div>
  );
}
