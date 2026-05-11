// Wizard step 3: column mapping.
// Pick which raw column carries each canonical PEGASUS field. The only
// required mapping is gene_symbol; the rest are optional and recommended
// based on the centric type (variant-centric sources want chromosome +
// position; gene-centric ones don't need them).

import { CANONICAL_FIELDS, REQUIRED_FIELDS } from "./types";
import type { WizardState } from "./types";

const FIELD_DESCRIPTIONS: Record<string, string> = {
  gene_symbol: "Gene HGNC symbol (required).",
  chromosome: "Chromosome — required for variant-centric sources.",
  position: "Variant base-pair position — required for variant-centric sources.",
  rsid: "Variant rsID.",
  pvalue: "Statistical significance.",
  effect_size: "Effect size, beta, or odds ratio.",
  score: "Method-specific scalar score (PIP, posterior, MR estimate, etc.).",
  tissue: "Tissue context (for QTL / colocalization rows).",
  cell_type: "Cell-type context.",
  ancestry: "Ancestry / population.",
  sex: "Sex stratification.",
  evidence_stream: "Sub-method within the category (eQTL vs sQTL, etc.).",
};

interface Props {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepMapping({ state, onPatch, onBack, onNext }: Props) {
  const setMapping = (field: string, raw: string) => {
    const next = { ...state.mappings };
    if (raw) next[field] = raw;
    else delete next[field];
    onPatch({ mappings: next });
  };

  const variantCentric = state.centric === "variant";
  const recommendedFor = (field: string): boolean => {
    if (field === "chromosome" || field === "position") return variantCentric;
    if (field === "rsid") return variantCentric;
    return false;
  };

  const hasGene = Boolean(state.mappings["gene_symbol"]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Map your columns</h2>
        <p className="text-sm text-base-content/60 mt-1">
          Tell us which raw column carries each canonical PEGASUS field.
          Only <code className="text-xs">gene_symbol</code> is required;
          fill in the others where applicable.
        </p>
      </div>

      <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
        <table className="table table-sm">
          <thead>
            <tr className="text-base-content/50">
              <th className="font-medium">Canonical field</th>
              <th className="font-medium">Raw column</th>
              <th className="font-medium">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {CANONICAL_FIELDS.map((field) => {
              const required = REQUIRED_FIELDS.has(field);
              const recommended = recommendedFor(field);
              return (
                <tr key={field}>
                  <td>
                    <span className="font-mono text-sm">
                      {field}
                      {required && (
                        <span className="text-error ml-0.5">*</span>
                      )}
                    </span>
                    {recommended && !required && (
                      <span className="ml-2 text-[10px] text-base-content/40 uppercase tracking-wider">
                        recommended
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="select select-bordered select-xs w-full"
                      value={state.mappings[field] ?? ""}
                      onChange={(e) => setMapping(field, e.target.value)}
                    >
                      <option value="">— none —</option>
                      {state.rawColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs text-base-content/50">
                    {FIELD_DESCRIPTIONS[field]}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hasGene && (
        <div role="alert" className="alert alert-warning text-sm">
          <span>
            You need to map <code className="text-xs">gene_symbol</code>{" "}
            before building. Pick the column that holds the gene name.
          </span>
        </div>
      )}

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
          disabled={!hasGene}
        >
          Next: review →
        </button>
      </div>
    </div>
  );
}
