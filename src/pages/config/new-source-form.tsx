// Wraps the SchemaForm with the source config schema and the insertSource
// write path. On submit, inserts a new row in config.source_configs (with
// no children — transformations and evidence_blocks are added later in the
// per-source detail editor) and notifies the caller of the new source's
// name so the workspace can navigate to it.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SchemaForm } from "../../components/schema-form/schema-form";
import { sourceConfigSchema } from "../../data/config-schema/source";
import { insertSource } from "../../data/sourceOps";
import type { V2fSourceConfig } from "../../api/types";
import type { FormState } from "../../components/schema-form/types";

export type NewSourceFormProps = {
  onCreated: (name: string) => void;
  onCancel: () => void;
};

export function NewSourceForm({ onCreated, onCancel }: NewSourceFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleSubmit = async (state: FormState) => {
    setError(null);
    setBusy(true);
    try {
      const source = state as unknown as V2fSourceConfig;
      await insertSource(source);
      await qc.invalidateQueries({ queryKey: ["config"] });
      await qc.invalidateQueries({ queryKey: ["sources"] });
      onCreated(source.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">New source</h2>
        <p className="text-sm text-base-content/60 mt-1">
          Add a new data source to <code className="text-xs">config.source_configs</code>.
          You'll add transformations and evidence blocks in the per-source editor afterwards.
        </p>
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm mb-4">
          <span>{error}</span>
        </div>
      )}

      <SchemaForm
        schema={sourceConfigSchema}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitLabel="Create source"
        busy={busy}
      />
    </div>
  );
}
