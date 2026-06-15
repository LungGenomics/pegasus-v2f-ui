// Power-user bulk import: stage one or many source config JSONs (drop file(s)
// or paste), review/remove the list, then import all in sequence. Each config
// goes through configIO.importSourceConfig; results are reported per source.
// Import order doesn't affect the eventual build (rebuildDerived orders loci
// before evidence regardless).

import { useRef, useState, type DragEvent } from "react";
import { X, Upload, Loader2, Check, AlertTriangle } from "lucide-react";
import { importSourceConfigs, type BatchImportEntry } from "../data/configIO";
import { rebuildDerived } from "../data/pipeline/derived";

type Staged = { id: number; label: string; raw: unknown };

function configName(raw: unknown): string | undefined {
  if (raw && typeof raw === "object") {
    const s = (raw as { source?: { name?: string } }).source;
    if (s?.name) return s.name;
  }
  return undefined;
}

export function SourceConfigImportModal({
  actor,
  onClose,
  onImported,
}: {
  actor: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [paste, setPaste] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [results, setResults] = useState<BatchImportEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Parse a JSON string (a single config object OR an array of them) and stage
  // each. Parse failures surface as an error without dropping prior items.
  const addParsed = (text: string, srcLabel: string) => {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErr(`${srcLabel}: invalid JSON — ${(e as Error).message}`);
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    setStaged((s) => [
      ...s,
      ...items.map((raw, i) => ({
        id: idRef.current++,
        label:
          configName(raw) ??
          (items.length > 1 ? `${srcLabel} [${i + 1}]` : srcLabel),
        raw,
      })),
    ]);
  };

  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith(".json")) {
        setErr(`${f.name}: not a .json file`);
        continue;
      }
      void f.text().then((t) => addParsed(t, f.name));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const remove = (id: number) =>
    setStaged((s) => s.filter((x) => x.id !== id));

  const doImport = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await importSourceConfigs(
        staged.map((s) => s.raw),
        actor,
      );
      setResults(r);
      setStaged([]); // consumed — re-add files to import again
      // Rebuild the derived layer ONCE after the batch (not per source) so
      // traits/loci/evidence reflect the new sources — the import path's
      // analogue of the auto-rebuild on a manual mapping edit. Skip if every
      // config failed (nothing to build).
      if (r.some((e) => e.ok)) {
        setRebuilding(true);
        try {
          await rebuildDerived(actor);
        } catch (e) {
          setErr(
            `Sources imported, but the derived-layer rebuild failed: ${(e as Error).message}`,
          );
        } finally {
          setRebuilding(false);
        }
      }
      onImported();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-xl">
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <h2 className="text-sm font-semibold">Import sources from config JSON</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-base-content/50 hover:text-base-content cursor-pointer"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Drop / browse — multiple files, each a config or an array of them */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-6 text-sm cursor-pointer transition-colors ${
              dragging
                ? "border-primary bg-primary/10"
                : "border-base-300 hover:border-base-content/30"
            }`}
          >
            <Upload className="size-4 text-primary" />
            Drop config JSON file(s) here, or click to browse
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Paste alternative */}
          <div>
            <textarea
              className="textarea textarea-bordered h-24 w-full font-mono text-xs"
              placeholder={
                'Or paste a config (or an array of configs):\n{ "source": {…}, "transforms": [], "mappings": [] }'
              }
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={!paste.trim()}
                onClick={() => {
                  addParsed(paste, "pasted");
                  setPaste("");
                }}
              >
                Add pasted
              </button>
            </div>
          </div>

          {err && (
            <div role="alert" className="alert alert-error text-sm">
              <span>{err}</span>
            </div>
          )}

          {/* Staged list — removable before import */}
          {staged.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                {staged.length} source{staged.length === 1 ? "" : "s"} staged
              </div>
              <div className="divide-y divide-base-300 rounded-lg border border-base-300 text-sm">
                {staged.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="flex-1 truncate font-mono">{s.label}</span>
                    <button
                      type="button"
                      onClick={() => remove(s.id)}
                      disabled={busy}
                      className="cursor-pointer text-base-content/40 hover:text-error"
                      aria-label={`Remove ${s.label}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-source results */}
          {results && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                Results
              </div>
              <div className="divide-y divide-base-300 rounded-lg border border-base-300 text-sm">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    {r.ok ? (
                      <Check className="size-3.5 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="size-3.5 shrink-0 text-error" />
                    )}
                    <span className="font-mono">{r.name}</span>
                    <span className="flex-1 truncate text-base-content/50">
                      {r.ok
                        ? `${r.rows ?? 0} rows · ${r.mappings ?? 0} mappings${
                            r.mappingErrors?.length
                              ? ` · ${r.mappingErrors.length} mapping err`
                              : ""
                          }`
                        : r.error}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-base-300 px-4 py-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            {results ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1"
            disabled={staged.length === 0 || busy}
            onClick={() => void doImport()}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {rebuilding
              ? "Rebuilding…"
              : busy
                ? "Importing…"
                : `Import ${staged.length || ""} source${staged.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
