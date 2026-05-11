// Wizard step 1: source metadata.
// On Next: fetch + parse the file in-memory and store columns + sample
// rows on the wizard state. No DB write happens until step 4.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { previewSource } from "../../../data/pipeline/load";
import type { WizardState } from "./types";

const SOURCE_TYPES = [
  { value: "googlesheets", label: "Google Sheets" },
  { value: "csv", label: "CSV file (HTTP)" },
  { value: "tsv", label: "TSV file (HTTP)" },
  { value: "url", label: "HTTPS URL" },
  { value: "parquet", label: "Parquet file (HTTP) — preview unsupported" },
];

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

interface Props {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  onNext: () => void;
  onCancel: () => void;
}

export function StepSource({ state, onPatch, onNext, onCancel }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameInvalid =
    state.name.length > 0 && !NAME_PATTERN.test(state.name);
  const canSubmit =
    state.name.length > 0 && !nameInvalid && state.url.length > 0;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const preview = await previewSource({
        name: state.name,
        source_type: state.source_type,
        url: state.url,
        sheet: state.sheet,
        skip_rows: state.skip_rows,
      });
      onPatch({
        rawColumns: preview.columns,
        rawPreviewRows: preview.sampleRows,
        rawRowCount: preview.totalRows,
      });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Where's the data?</h2>

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">Name *</span>
        </label>
        <input
          type="text"
          className="input input-bordered input-sm w-full"
          value={state.name}
          placeholder="shrine_2023_fev1"
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        {nameInvalid && (
          <span className="text-xs text-error mt-1">
            Lowercase letters, digits, underscores; must start with a letter.
          </span>
        )}
        {!nameInvalid && (
          <span className="text-xs text-base-content/60 mt-1">
            Internal identifier — appears in raw table names and source tags.
          </span>
        )}
      </div>

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">Display name</span>
        </label>
        <input
          type="text"
          className="input input-bordered input-sm w-full"
          value={state.display_name}
          placeholder="Shrine 2023 PHEWAS — FEV1"
          onChange={(e) => onPatch({ display_name: e.target.value })}
        />
      </div>

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">Source type *</span>
        </label>
        <select
          className="select select-bordered select-sm w-full"
          value={state.source_type}
          onChange={(e) => onPatch({ source_type: e.target.value })}
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">URL *</span>
        </label>
        <input
          type="text"
          className="input input-bordered input-sm w-full"
          value={state.url}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          onChange={(e) => onPatch({ url: e.target.value })}
        />
      </div>

      {state.source_type === "googlesheets" && (
        <div className="form-control">
          <label className="label py-1">
            <span className="label-text text-sm">Sheet (tab) name</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            value={state.sheet}
            placeholder="(blank = first tab)"
            onChange={(e) => onPatch({ sheet: e.target.value })}
          />
        </div>
      )}

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">Skip rows</span>
        </label>
        <input
          type="number"
          className="input input-bordered input-sm w-full"
          min={0}
          value={state.skip_rows}
          onChange={(e) =>
            onPatch({ skip_rows: Number(e.target.value) || 0 })
          }
        />
        <span className="text-xs text-base-content/60 mt-1">
          Header / banner rows to skip before parsing.
        </span>
      </div>

      <div className="form-control">
        <label className="label py-1">
          <span className="label-text text-sm">Description</span>
        </label>
        <textarea
          className="textarea textarea-bordered textarea-sm w-full"
          rows={2}
          value={state.description}
          placeholder="Free-form notes on this source."
          onChange={(e) => onPatch({ description: e.target.value })}
        />
      </div>

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1"
          onClick={submit}
          disabled={!canSubmit || loading}
        >
          {loading && <Loader2 className="size-3 animate-spin" />}
          Next: preview →
        </button>
      </div>
    </div>
  );
}
