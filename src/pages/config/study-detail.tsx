import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, MapPin, Pencil, Users } from "lucide-react";
import type { V2fStudyConfig } from "../../api/types";
import { SchemaForm } from "../../components/schema-form/schema-form";
import { studyConfigSchema } from "../../data/config-schema/study";
import { patchStudyConfig } from "../../data/studyOps";
import type { FormState } from "../../components/schema-form/types";

interface Props {
  study: V2fStudyConfig;
}

export function StudyDetail({ study }: Props) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (state: FormState) => {
    setError(null);
    setBusy(true);
    try {
      await patchStudyConfig(study.id_prefix, state as unknown as V2fStudyConfig);
      await qc.invalidateQueries({ queryKey: ["config"] });
      await qc.invalidateQueries({ queryKey: ["studies"] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold flex-1">Edit study</h2>
        </div>
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}
        <SchemaForm
          schema={studyConfigSchema}
          initialValue={study as unknown as FormState}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(false)}
          submitLabel="Save"
          busy={busy}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{study.id_prefix}</h2>
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-base-content/60">
            {study.gwas_source && (
              <span className="flex items-center gap-1">
                <BookOpen className="size-3.5" />
                {study.gwas_source}
              </span>
            )}
            {study.ancestry && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {study.ancestry}
              </span>
            )}
            {study.sample_size && (
              <span>N = {study.sample_size.toLocaleString()}</span>
            )}
            {study.doi && <span>DOI: {study.doi}</span>}
            {study.year && <span>{study.year}</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3.5" />
          Edit
        </button>
      </div>

      {/* Traits */}
      <section>
        <h3 className="text-sm font-medium text-base-content/60 mb-3">
          Traits ({study.traits?.length ?? 0})
        </h3>
        <div className="flex flex-wrap gap-2">
          {(study.traits ?? []).map((trait) => (
            <span key={trait} className="badge badge-outline">
              {trait}
            </span>
          ))}
        </div>
      </section>

      {/* Loci source */}
      <section>
        <h3 className="text-sm font-medium text-base-content/60 mb-3 flex items-center gap-1.5">
          <MapPin className="size-4" />
          Loci Source
        </h3>
        <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
          <div className="px-4 py-3 text-sm space-y-1 text-base-content/70">
            {study.loci_source && (
              <p className="truncate" title={study.loci_source}>
                <span className="text-base-content/50">Source:</span> {study.loci_source}
              </p>
            )}
            {study.loci_sheet && (
              <p>
                <span className="text-base-content/50">Sheet:</span> {study.loci_sheet}
              </p>
            )}
            {study.loci_skip ? (
              <p>
                <span className="text-base-content/50">Skip:</span> {study.loci_skip} rows
              </p>
            ) : null}
            {study.gene_column && (
              <p>
                <span className="text-base-content/50">Gene column:</span> {study.gene_column}
              </p>
            )}
            {study.sentinel_column && (
              <p>
                <span className="text-base-content/50">Sentinel column:</span> {study.sentinel_column}
              </p>
            )}
            {study.pvalue_column && (
              <p>
                <span className="text-base-content/50">P-value column:</span> {study.pvalue_column}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Transforms (if any) */}
      {study.transformations && study.transformations.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-base-content/60 mb-3">
            Transforms ({study.transformations.length})
          </h3>
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
            {study.transformations.map((t, i) => (
              <div
                key={i}
                className={`px-4 py-2 text-sm font-mono ${
                  i > 0 ? "border-t border-base-300" : ""
                }`}
              >
                {t.type}
                {t.column ? `(${t.column})` : ""}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
