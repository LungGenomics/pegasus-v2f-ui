// Wizard step 2: interpret.
// Shows a preview of the data + asks what it represents (category,
// role, centric, trait scope). Trait picker uses TraitInput for
// constant scope, a raw-column dropdown for column scope.

import { EVIDENCE_CATEGORIES } from "../../../data/static";
import { TraitInput } from "../../../components/trait-input";
import type {
  DerivationCentric,
  DerivationRole,
  DerivationTraitScope,
} from "../../../api/types";
import type { WizardState } from "./types";

const CATEGORY_OPTIONS = Object.entries(EVIDENCE_CATEGORIES).map(
  ([abbrev, label]) => ({ value: abbrev, label: `${abbrev} — ${label}` }),
);

const ANCESTRY_OPTIONS = [
  { value: "", label: "—" },
  { value: "EUR", label: "European" },
  { value: "AFR", label: "African" },
  { value: "EAS", label: "East Asian" },
  { value: "SAS", label: "South Asian" },
  { value: "AMR", label: "Admixed American" },
  { value: "MIXED", label: "Mixed" },
  { value: "OTHER", label: "Other" },
];

interface Props {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepInterpret({ state, onPatch, onBack, onNext }: Props) {
  const isLoci = state.role === "loci_definition";
  const canSubmit =
    state.evidence_category.length > 0 &&
    (state.trait_scope === "constant"
      ? state.trait_ids.length > 0
      : state.trait_column.length > 0);

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-lg font-semibold">What does this data describe?</h2>

      {/* Preview table */}
      <section>
        <div className="text-xs text-base-content/60 mb-1.5">
          Preview ({state.rawPreviewRows.length} of {state.rawRowCount} rows,
          {" "}
          {state.rawColumns.length} columns)
        </div>
        <div className="overflow-x-auto border border-base-300 rounded-lg bg-base-100">
          <table className="table table-xs">
            <thead>
              <tr className="text-base-content/40">
                {state.rawColumns.map((c) => (
                  <th key={c} className="whitespace-nowrap font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rawPreviewRows.map((row, i) => (
                <tr key={i}>
                  {state.rawColumns.map((c) => (
                    <td key={c} className="max-w-48 truncate">
                      {row[c] == null ? (
                        <span className="text-base-content/20">null</span>
                      ) : (
                        String(row[c])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kind of data */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Evidence category *</span>
          </label>
          <select
            className="select select-bordered select-sm w-full"
            value={state.evidence_category}
            onChange={(e) => onPatch({ evidence_category: e.target.value })}
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
            <span className="label-text text-sm">Each row describes a *</span>
          </label>
          <div className="flex gap-3 pt-1">
            <label className="cursor-pointer flex items-center gap-1.5">
              <input
                type="radio"
                name="centric"
                className="radio radio-xs"
                checked={state.centric === "variant"}
                onChange={() =>
                  onPatch({ centric: "variant" as DerivationCentric })
                }
              />
              <span className="text-sm">variant</span>
            </label>
            <label className="cursor-pointer flex items-center gap-1.5">
              <input
                type="radio"
                name="centric"
                className="radio radio-xs"
                checked={state.centric === "gene"}
                onChange={() =>
                  onPatch({ centric: "gene" as DerivationCentric })
                }
              />
              <span className="text-sm">gene</span>
            </label>
          </div>
        </div>
      </div>

      {/* Role toggle (loci_definition) */}
      <div className="form-control">
        <label className="cursor-pointer flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={isLoci}
            onChange={(e) =>
              onPatch({
                role: (e.target.checked
                  ? "loci_definition"
                  : "evidence") as DerivationRole,
              })
            }
          />
          <span className="text-sm">
            This source defines loci / sentinels for studies (GWAS-style)
          </span>
        </label>
      </div>

      {/* Citation (only when loci_definition) */}
      {isLoci && (
        <section className="border border-base-300 rounded-lg bg-base-100 p-4 space-y-3">
          <div className="text-xs font-medium text-base-content/60">
            Citation (optional)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">GWAS source</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                value={state.citation?.gwas_source ?? ""}
                placeholder="Shrine et al. 2023"
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      gwas_source: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">Ancestry</span>
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={state.citation?.ancestry ?? ""}
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      ancestry: e.target.value,
                    },
                  })
                }
              >
                {ANCESTRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">Sample size</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm w-full"
                value={state.citation?.sample_size ?? ""}
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      sample_size: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">Year</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm w-full"
                min={1900}
                max={2100}
                value={state.citation?.year ?? ""}
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      year: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">DOI</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                value={state.citation?.doi ?? ""}
                placeholder="10.1038/…"
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      doi: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-xs">PubMed ID</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                value={state.citation?.pubmed_id ?? ""}
                onChange={(e) =>
                  onPatch({
                    citation: {
                      ...(state.citation ?? {}),
                      pubmed_id: e.target.value,
                    },
                  })
                }
              />
            </div>
          </div>
        </section>
      )}

      {/* Trait scope */}
      <section>
        <div className="text-xs font-medium text-base-content/60 mb-2">
          Trait coverage
        </div>
        <div className="flex flex-col gap-2">
          <label className="cursor-pointer flex items-start gap-2">
            <input
              type="radio"
              name="trait_scope"
              className="radio radio-xs mt-0.5"
              checked={state.trait_scope === "constant"}
              onChange={() =>
                onPatch({ trait_scope: "constant" as DerivationTraitScope })
              }
            />
            <div className="flex-1">
              <div className="text-sm">Same trait(s) for every row</div>
              <div className="text-xs text-base-content/50">
                Best for GWAS / colocalization sheets where every row is
                about a fixed phenotype.
              </div>
            </div>
          </label>
          <label className="cursor-pointer flex items-start gap-2">
            <input
              type="radio"
              name="trait_scope"
              className="radio radio-xs mt-0.5"
              checked={state.trait_scope === "column"}
              onChange={() =>
                onPatch({ trait_scope: "column" as DerivationTraitScope })
              }
            />
            <div className="flex-1">
              <div className="text-sm">Trait varies by row (column)</div>
              <div className="text-xs text-base-content/50">
                Best for PhewAS / multi-trait catalogs where one column
                names the phenotype per row.
              </div>
            </div>
          </label>
        </div>

        <div className="mt-3">
          {state.trait_scope === "constant" ? (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-sm">Traits *</span>
              </label>
              <TraitInput
                value={state.trait_ids}
                onChange={(next) => onPatch({ trait_ids: next })}
                multiple
                placeholder="Search FEV1, asthma, …"
              />
            </div>
          ) : (
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-sm">Trait column *</span>
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={state.trait_column}
                onChange={(e) => onPatch({ trait_column: e.target.value })}
              >
                <option value="">— pick a column —</option>
                {state.rawColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-xs text-base-content/60 mt-1">
                On build, distinct values in this column will become
                config.traits rows (find-or-create by label).
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onBack}
        >
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onNext}
          disabled={!canSubmit}
        >
          Next: column mapping →
        </button>
      </div>
    </div>
  );
}
