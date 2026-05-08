import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, MapPin, Pencil, Users, Loader2 } from "lucide-react";
import type {
  V2fStudyConfig,
  TransformConfigEntry,
} from "../../api/types";
import { SchemaFields } from "../../components/schema-form/schema-form";
import { SchemaFormProvider } from "../../components/schema-form/context";
import { studyConfigSchema } from "../../data/config-schema/study";
import { patchStudyConfig } from "../../data/studyOps";
import type { FormState } from "../../components/schema-form/types";
import { TransformEditor } from "./transform-editor";
import { TransformPicker } from "./transform-picker";

interface Props {
  study: V2fStudyConfig;
}

export function StudyDetail({ study }: Props) {
  const [draft, setDraft] = useState<V2fStudyConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const editing = draft !== null;

  const startEdit = () => {
    setError(null);
    setDraft(structuredClone(study));
  };
  const cancelEdit = () => {
    setError(null);
    setDraft(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      await patchStudyConfig(study.id_prefix, draft);
      await qc.invalidateQueries({ queryKey: ["config"] });
      await qc.invalidateQueries({ queryKey: ["studies"] });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Transformations are stored on the draft; in read mode we show the
  // persisted set. A study currently has no raw-data preview pipeline
  // (no raw_<study> table), so TransformEditor renders without preview.
  const activeTransforms = (
    editing
      ? (draft?.transformations ?? [])
      : (study.transformations ?? [])
  ) as TransformConfigEntry[];

  const setTransforms = (next: TransformConfigEntry[]) => {
    setDraft((prev) => (prev ? { ...prev, transformations: next } : prev));
  };

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
        {!editing ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1"
            onClick={startEdit}
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={cancelEdit}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-xs gap-1"
              onClick={handleSave}
              disabled={busy}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              Save
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      {/* Settings — schema-driven editor for top-level fields. Visible only
          when editing; the read-only header above carries enough info. */}
      {editing && draft && (
        <section className="border border-base-300 rounded-lg bg-base-100 p-4 space-y-3">
          <div className="text-xs font-medium text-base-content/50">Settings</div>
          <SchemaFields
            schema={studyConfigSchema}
            value={draft as unknown as FormState}
            onChange={(next) =>
              setDraft((prev) =>
                prev
                  ? ({ ...prev, ...(next as unknown as Partial<V2fStudyConfig>) })
                  : prev,
              )
            }
          />
        </section>
      )}

      {/* Read-only Traits + Loci Source — only shown when not editing,
          since the schema-form above already covers these fields. */}
      {!editing && (
        <>
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
        </>
      )}

      {/* Transformations — editable when editing, read-only list otherwise.
          Studies don't have a raw-data preview pipeline, so we omit per-stage
          previews; TransformEditor renders fields without them. */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-base-content/60 flex-1">
            Transforms ({activeTransforms.length})
          </h3>
        </div>

        {editing ? (
          <SchemaFormProvider columns={[]}>
            <div className="space-y-2">
              {activeTransforms.map((t, i) => (
                <div
                  key={i}
                  className="border border-base-300 rounded-lg bg-base-100"
                >
                  <TransformEditor
                    config={t}
                    availableColumns={[]}
                    onChange={(updated) => {
                      const next = [...activeTransforms];
                      next[i] = updated;
                      setTransforms(next);
                    }}
                    onRemove={() =>
                      setTransforms(activeTransforms.filter((_, j) => j !== i))
                    }
                    onMoveUp={() => {
                      if (i === 0) return;
                      const next = [...activeTransforms];
                      const tmp = next[i - 1]!;
                      next[i - 1] = next[i]!;
                      next[i] = tmp;
                      setTransforms(next);
                    }}
                    onMoveDown={() => {
                      if (i === activeTransforms.length - 1) return;
                      const next = [...activeTransforms];
                      const tmp = next[i]!;
                      next[i] = next[i + 1]!;
                      next[i + 1] = tmp;
                      setTransforms(next);
                    }}
                    isFirst={i === 0}
                    isLast={i === activeTransforms.length - 1}
                  />
                </div>
              ))}
              <div className="border border-dashed border-base-300 rounded-lg px-3 py-2">
                <TransformPicker
                  onAdd={(config) =>
                    setTransforms([...activeTransforms, config])
                  }
                />
              </div>
            </div>
          </SchemaFormProvider>
        ) : activeTransforms.length > 0 ? (
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
            {activeTransforms.map((t, i) => (
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
        ) : (
          <p className="text-sm text-base-content/30 italic">No transforms</p>
        )}
      </section>
    </div>
  );
}
