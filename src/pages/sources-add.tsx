// Add-source panel for the redesigned Sources workspace. Full-width (fills the
// right work-area column), built fresh — not the old max-w-2xl wizard. Same
// ingest-on-add engine (ingestSource): pick an input, name it, and it's
// materialized as a raw table immediately.

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { UploadCloud, Loader2, FileText, X, RefreshCw } from "lucide-react";
import { ingestSource } from "../data/pipeline/ingest";
import { previewRaw, type RawPreview } from "../data/pipeline/load";
import type { InsertSourceInput } from "../data/sourceOps";

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

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Consistent label-above-input field: same label styling, spacing, and
 *  full-width input everywhere (DaisyUI 5 dropped form-control/label-text). */
function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-base-content/70 mb-1.5">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-error mt-1">{error}</span>}
    </label>
  );
}

export function AddSourcePanel({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (sourceName: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sheet, setSheet] = useState("");
  const [skipRows, setSkipRows] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<RawPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const loadedOptsRef = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);

  const hasInput = !!file || !!url.trim();
  const sourceType = file ? "file" : url ? detectType(url) : "";
  const nameValid = NAME_RE.test(name);
  const previewStale =
    hasInput &&
    preview != null &&
    !previewBusy &&
    `${sheet}|${skipRows}` !== loadedOptsRef.current;
  // Gate ingest on a current, successful preview so the user always sees
  // exactly what gets added — block while loading, out of date, or unpreviewed.
  const canSubmit =
    hasInput &&
    nameValid &&
    !busy &&
    !previewBusy &&
    !previewStale &&
    preview != null;

  // Preview loads automatically when the input source (file / URL) changes
  // and on demand via Refresh (refreshTick). It deliberately does NOT auto-run
  // on sheet / skip-rows edits — those re-fetch the network for URL/Sheet
  // sources, so the user applies them explicitly with Refresh.
  useEffect(() => {
    if (!hasInput) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    setPreviewErr(null);
    loadedOptsRef.current = `${sheet}|${skipRows}`;
    previewRaw(
      {
        source_type: sourceType,
        url: url || undefined,
        sheet: sheet || undefined,
        skip_rows: skipRows || undefined,
      },
      file,
    )
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewErr(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // sheet/skipRows intentionally excluded — applied via Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, url, sourceType, hasInput, refreshTick]);

  const pickFile = (f: File) => {
    setFile(f);
    setUrl("");
    if (!name) setName(slugify(f.name));
  };

  const pickUrl = (u: string) => {
    const trimmed = u.trim();
    setUrl(trimmed);
    setFile(null);
    if (!name) {
      const tail = trimmed.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
      if (/\.[a-z0-9]{2,5}$/i.test(tail)) setName(slugify(tail));
    }
  };

  const clearInput = () => {
    setFile(null);
    setUrl("");
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
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
    <div>
      <h1 className="text-lg font-semibold mb-1">Add a source</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Drop a file or paste a Google Sheets / URL — it's ingested into the
        local database immediately as a raw table.
      </p>

      {!hasInput ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed p-16 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-base-300"
          }`}
        >
          <UploadCloud className="size-10 mx-auto mb-3 text-base-content/30" />
          <p className="font-medium mb-1">Drop a file to ingest</p>
          <p className="text-sm text-base-content/50 mb-6">
            CSV, TSV, or text — or{" "}
            <button
              type="button"
              className="link link-primary"
              onClick={() => fileRef.current?.click()}
            >
              browse
            </button>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.parquet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
            }}
          />
          <div className="mx-auto max-w-xl flex items-center gap-2">
            <div className="h-px flex-1 bg-base-300" />
            <span className="text-xs text-base-content/40">or paste a URL</span>
            <div className="h-px flex-1 bg-base-300" />
          </div>
          <div className="mx-auto max-w-xl flex items-center gap-2 mt-3">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="https://docs.google.com/spreadsheets/d/… or a CSV/TSV/Parquet URL"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pickUrl(urlDraft);
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => pickUrl(urlDraft)}
              disabled={!urlDraft.trim()}
            >
              Go
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-200/30 px-3 py-2 text-sm">
            <FileText className="size-4 text-primary shrink-0" />
            <span className="truncate flex-1 font-mono text-xs">
              {file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : url}
            </span>
            <span className="badge badge-sm">{sourceType}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={clearInput}
              disabled={busy}
              aria-label="Change input"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Source name"
              required
              error={
                name.length > 0 && !nameValid
                  ? "Only lowercase letters, digits, underscores."
                  : undefined
              }
            >
              <input
                className={`input input-bordered input-sm w-full ${name.length > 0 && !nameValid ? "input-error" : ""}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="lowercase_digits_underscores"
              />
            </Field>

            <Field label="Display name">
              <input
                className="input input-bordered input-sm w-full"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="optional, human-readable"
              />
            </Field>

            {sourceType === "googlesheets" && (
              <Field label="Sheet (tab) name">
                <input
                  className="input input-bordered input-sm w-full"
                  value={sheet}
                  onChange={(e) => setSheet(e.target.value)}
                  placeholder="optional — defaults to the first tab"
                />
              </Field>
            )}

            <Field label="Skip rows">
              <input
                type="number"
                min={0}
                className="input input-bordered input-sm w-full"
                value={skipRows}
                onChange={(e) => setSkipRows(Number(e.target.value) || 0)}
              />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
                  Preview
                </span>
                {preview && preview.columns.length > 0 && (
                  <span className="text-xs text-base-content/40">
                    {preview.columns.length} columns · first {preview.rows.length} rows
                  </span>
                )}
                {previewStale && (
                  <span className="text-xs text-error">out of date</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRefreshTick((t) => t + 1)}
                disabled={previewBusy || !hasInput}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40 ${
                  previewStale
                    ? "bg-error/10 text-error font-medium hover:bg-error/15"
                    : "text-base-content/50 hover:text-base-content hover:bg-base-200"
                }`}
              >
                <RefreshCw
                  className={`size-3.5 ${previewBusy ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>
            <div className="border border-base-300 rounded-lg overflow-auto max-h-96">
              {previewBusy ? (
                <div className="p-8 text-center text-sm text-base-content/40">
                  <Loader2 className="size-4 animate-spin inline mr-2" />
                  Loading preview…
                </div>
              ) : previewErr ? (
                <div className="p-4 text-sm text-error">{previewErr}</div>
              ) : preview && preview.columns.length > 0 ? (
                <table className="table table-xs table-pin-rows">
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c} className="font-mono whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c} className="font-mono whitespace-nowrap">
                            {fmtCell(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-sm text-base-content/40">
                  No preview available.
                </div>
              )}
            </div>
          </div>

          {error && (
            <div role="alert" className="alert alert-error text-sm">
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {previewStale && (
              <span className="mr-auto flex items-center text-xs font-medium text-error bg-error/10 rounded-md px-2 py-1">
                Refresh the preview to ingest the current settings.
              </span>
            )}
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
