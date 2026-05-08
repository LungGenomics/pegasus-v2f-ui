// Schema-driven create form for a study. Mirrors NewSourceForm — wraps
// SchemaForm with studyConfigSchema and the insertStudy write path.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SchemaForm } from "../../components/schema-form/schema-form";
import { studyConfigSchema } from "../../data/config-schema/study";
import { insertStudy } from "../../data/studyOps";
import type { V2fStudyConfig } from "../../api/types";
import type { FormState } from "../../components/schema-form/types";

export type NewStudyFormProps = {
  onCreated: (idPrefix: string) => void;
  onCancel: () => void;
};

export function NewStudyForm({ onCreated, onCancel }: NewStudyFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleSubmit = async (state: FormState) => {
    setError(null);
    setBusy(true);
    try {
      const study = state as unknown as V2fStudyConfig;
      await insertStudy(study);
      await qc.invalidateQueries({ queryKey: ["config"] });
      await qc.invalidateQueries({ queryKey: ["studies"] });
      onCreated(study.id_prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">New study</h2>
        <p className="text-sm text-base-content/60 mt-1">
          Add a new study to <code className="text-xs">config.study_configs</code>.
          Loci will be loaded from the chosen loci source when you build.
        </p>
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm mb-4">
          <span>{error}</span>
        </div>
      )}

      <SchemaForm
        schema={studyConfigSchema}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitLabel="Create study"
        busy={busy}
      />
    </div>
  );
}
