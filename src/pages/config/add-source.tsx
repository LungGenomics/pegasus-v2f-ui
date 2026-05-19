// Ingest-on-add entry (Phase 1). Replaces the linear 5-step wizard as
// the way you add a source: pick an input (file drop or Sheet/URL),
// name it, and it's ingested into the local DB immediately as a raw
// table. Derivations/transforms/build happen afterward in the source
// detail editor (the future workspace). No config required up front.

import { useState } from "react";
import { ArrowLeft, Loader2, Database } from "lucide-react";
import { DropZone } from "../../components/drop-zone";
import { ingestSource } from "../../data/pipeline/ingest";
import type { InsertSourceInput } from "../../data/sourceOps";

const NAME_RE = /^[a-z0-9_]+$/;

function detectType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("docs.google.com/spreadsheets")) return "googlesheets";
  if (u.endsWith(".parquet")) return "parquet";
  if (u.endsWith(".tsv") || u.endsWith(".txt")) return "tsv";
  if (u.endsWith(".csv")) return "csv";
  return "url";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function AddSource({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (sourceName: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sheet, setSheet] = useState("");
  const [skipRows, setSkipRows] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInput = !!file || !!url.trim();
  const sourceType = file ? "file" : url ? detectType(url) : "";
  const nameValid = NAME_RE.test(name);
  const canSubmit = hasInput && nameValid && !busy;

  const pickFile = (f: File) => {
    setFile(f);
    setUrl("");
    if (!name) setName(slugify(f.name));
  };
  const pickUrl = (u: string) => {
    setUrl(u);
    setFile(null);
    if (!name) {
      // sheet/url: derive a slug from the last meaningful path part
      const tail = u.split(/[/?#]/).filter(Boolean).pop() ?? "source";
      setName(slugify(tail) || "source");
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const input: InsertSourceInput = {
        name,
        source_type: sourceType,
        display_name: displayName || undefined,
        skip_rows: skipRows || undefined,
      };
      if (!file) {
        input.url = url.trim();
        if (sourceType === "googlesheets" && sheet) input.sheet = sheet;
      }
      const res = await ingestSource(input, file ?? undefined);
      onDone(res.source.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content mb-4"
        type="button"
      >
        <ArrowLeft className="size-3.5" />
        Sources
      </button>

      <h1 className="text-lg font-semibold mb-1">Add a source</h1>
      <p className="text-sm text-base-content/60 mb-4">
        Drop a file or paste a Google Sheets/URL. It's ingested into the
        local database immediately as a raw table — you configure
        derivations and build afterward, in the source view.
      </p>

      {!hasInput ? (
        <DropZone onFile={pickFile} onUrl={pickUrl} />
      ) : (
        <div className="space-y-3">
          <div className="alert text-sm py-2">
            <Database className="size-4 shrink-0" />
            <span>
              {file ? (
                <>
                  File <code className="font-mono">{file.name}</code>{" "}
                  ({(file.size / 1024).toFixed(0)} KB) ·{" "}
                  <span className="badge badge-xs">{sourceType}</span>
                </>
              ) : (
                <>
                  <span className="break-all">{url}</span> ·{" "}
                  <span className="badge badge-xs">{sourceType}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setFile(null);
                setUrl("");
              }}
              disabled={busy}
            >
              change
            </button>
          </div>

          <label className="form-control">
            <span className="label-text text-sm">
              Source name <span className="text-error">*</span>
            </span>
            <input
              className={`input input-bordered input-sm ${
                name && !nameValid ? "input-error" : ""
              }`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lowercase_digits_underscores"
            />
            {name && !nameValid && (
              <span className="label-text-alt text-error">
                Only lowercase letters, digits, underscores.
              </span>
            )}
          </label>

          <label className="form-control">
            <span className="label-text text-sm">Display name</span>
            <input
              className="input input-bordered input-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="optional, human-readable"
            />
          </label>

          {sourceType === "googlesheets" && (
            <label className="form-control">
              <span className="label-text text-sm">Sheet (tab) name</span>
              <input
                className="input input-bordered input-sm"
                value={sheet}
                onChange={(e) => setSheet(e.target.value)}
                placeholder="optional — defaults to the first tab"
              />
            </label>
          )}

          <label className="form-control">
            <span className="label-text text-sm">Skip rows</span>
            <input
              type="number"
              min={0}
              className="input input-bordered input-sm w-28"
              value={skipRows}
              onChange={(e) => setSkipRows(Number(e.target.value) || 0)}
            />
          </label>

          {error && (
            <div role="alert" className="alert alert-error text-sm">
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
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
              disabled={!canSubmit}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? "Ingesting…" : "Ingest source"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
