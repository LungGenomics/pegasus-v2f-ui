// Wizard step 4: review + build.
// Summarises everything the user picked, then on Save runs the full
// commit path: insertSource → insertDerivation → buildSource (load +
// route + loci). Reports progress per phase.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { insertSource } from "../../../data/sourceOps";
import { insertDerivation } from "../../../data/derivationOps";
import { buildSource } from "../../../data/pipeline/build";
import type { DerivationMapping } from "../../../api/types";
import type { WizardState } from "./types";

interface Props {
  state: WizardState;
  onBack: () => void;
  onDone: (sourceName: string) => void;
  onCancel: () => void;
}

type BuildStage = "pending" | "saving" | "routing" | "deriving" | "done";

interface BuildProgress {
  stage: BuildStage;
  message?: string;
  rows?: number;
  loci?: number;
  error?: string;
}

export function StepBuild({ state, onBack, onDone, onCancel }: Props) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BuildProgress>({ stage: "pending" });

  const save = async () => {
    setProgress({ stage: "saving", message: "Inserting source…" });
    try {
      // Insert source + citation
      const sourceId = await insertSource({
        name: state.name,
        display_name: state.display_name || undefined,
        description: state.description || undefined,
        source_type: state.source_type,
        url: state.url,
        sheet: state.sheet || undefined,
        skip_rows: state.skip_rows,
        citation:
          state.role === "loci_definition" && state.citation
            ? state.citation
            : undefined,
        trait_ids:
          state.trait_scope === "constant" && state.trait_ids.length > 0
            ? state.trait_ids
            : undefined,
      });

      // Insert one derivation. The wizard creates exactly one
      // derivation; multi-derivation sources are an advanced
      // affordance on the source detail page (Phase 4).
      const sourceTag = `${state.name}__${state.evidence_category}`;
      const mappings: DerivationMapping[] = Object.entries(state.mappings).map(
        ([canonical_field, raw_column]) => ({ canonical_field, raw_column }),
      );

      setProgress({ stage: "routing", message: "Saving derivation…" });
      await insertDerivation({
        source_id: sourceId,
        source_tag: sourceTag,
        role: state.role,
        evidence_category: state.evidence_category,
        centric: state.centric,
        trait_scope: state.trait_scope,
        mappings,
        trait_ids:
          state.trait_scope === "constant" ? state.trait_ids : undefined,
        trait_column:
          state.trait_scope === "column"
            ? { raw_column: state.trait_column }
            : undefined,
      });

      // Build: load + route + (loci if applicable)
      setProgress({ stage: "deriving", message: "Building…" });
      const result = await buildSource(state.name);
      const rows = result.derivations.reduce((a, d) => a + d.rows, 0);
      const loci = result.loci.reduce((a, l) => a + l.loci, 0);

      await qc.invalidateQueries();
      setProgress({ stage: "done", rows, loci });
    } catch (err) {
      setProgress({
        stage: "pending",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const busy =
    progress.stage === "saving" ||
    progress.stage === "routing" ||
    progress.stage === "deriving";
  const done = progress.stage === "done";

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Review and build</h2>

      <div className="border border-base-300 rounded-lg bg-base-100 divide-y divide-base-300">
        <SummaryRow label="Source name" value={state.name} />
        {state.display_name && (
          <SummaryRow label="Display name" value={state.display_name} />
        )}
        <SummaryRow label="Type" value={state.source_type} />
        <SummaryRow label="URL" value={state.url} truncate />
        {state.sheet && <SummaryRow label="Sheet" value={state.sheet} />}
        <SummaryRow
          label="Category"
          value={`${state.evidence_category}, ${state.centric}-centric`}
        />
        <SummaryRow
          label="Role"
          value={state.role === "loci_definition" ? "defines loci" : "evidence"}
        />
        {state.role === "loci_definition" && state.citation?.gwas_source && (
          <SummaryRow
            label="Citation"
            value={[
              state.citation.gwas_source,
              state.citation.year,
              state.citation.ancestry,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
        <SummaryRow
          label="Trait scope"
          value={
            state.trait_scope === "constant"
              ? `${state.trait_ids.length} constant trait${state.trait_ids.length === 1 ? "" : "s"}`
              : `per-row column "${state.trait_column}"`
          }
        />
        <SummaryRow
          label="Mappings"
          value={`${Object.keys(state.mappings).length} fields`}
        />
        <SummaryRow label="Preview" value={`${state.rawRowCount} rows`} />
      </div>

      {/* Build progress / result */}
      {progress.error && (
        <div role="alert" className="alert alert-error text-sm">
          <AlertTriangle className="size-4" />
          <span>{progress.error}</span>
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-base-content/70">
          <Loader2 className="size-4 animate-spin" />
          {progress.message}
        </div>
      )}
      {done && (
        <div role="alert" className="alert alert-success text-sm">
          <CheckCircle2 className="size-4" />
          <span>
            Built <code className="text-xs">{state.name}</code> —{" "}
            {progress.rows ?? 0} evidence rows
            {state.role === "loci_definition" &&
              `, ${progress.loci ?? 0} loci`}
            .
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {!done ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onBack}
              disabled={busy}
            >
              ← Back
            </button>
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
              onClick={save}
              disabled={busy}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              Save and build
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onDone(state.name)}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  truncate,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="px-4 py-2 flex gap-4 text-sm">
      <span className="text-base-content/50 shrink-0 w-32">{label}</span>
      <span className={`flex-1 min-w-0 ${truncate ? "truncate" : ""}`}>
        {value}
      </span>
    </div>
  );
}
