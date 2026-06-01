// Reusable JSON import/export modal for power-user bulk editing (transforms,
// mappings). Shows the current value as copyable JSON (export) and a paste box
// (import) with an optional append/replace mode toggle. The caller does the
// actual apply (sync draft edit or async DB write) via onApply and returns a
// summary; this component only handles the JSON text + parse + result display.

import { useState } from "react";
import { X, Copy, Check } from "lucide-react";

export type JsonIoMode = "append" | "replace";

export interface ApplyResult {
  applied: number;
  errors: string[];
}

export function JsonIoModal({
  title,
  exportValue,
  modes,
  onApply,
  onClose,
}: {
  title: string;
  /** Current value, shown (JSON-stringified) in the export box. */
  exportValue: unknown;
  /** Import modes to offer; omit for a single implicit mode. */
  modes?: JsonIoMode[];
  /** Apply parsed JSON. Throw for a fatal/parse-level problem; return per-entry
   *  errors in the result for partial success. */
  onApply: (parsed: unknown, mode: JsonIoMode) => Promise<ApplyResult>;
  onClose: () => void;
}) {
  const exportText = JSON.stringify(exportValue ?? [], null, 2);
  const [importText, setImportText] = useState("");
  const [mode, setMode] = useState<JsonIoMode>(modes?.[0] ?? "replace");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the text is selectable in the box */
    }
  };

  const apply = async () => {
    setErr(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      setErr(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      setResult(await onApply(parsed, mode));
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
          <h2 className="text-sm font-semibold">{title} — JSON</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-base-content/50 hover:text-base-content cursor-pointer disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-base-content/50">
                Export (current)
              </span>
              <button
                type="button"
                onClick={() => void copy()}
                className="text-xs inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="size-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> Copy
                  </>
                )}
              </button>
            </div>
            <textarea
              readOnly
              value={exportText}
              rows={8}
              spellCheck={false}
              className="textarea textarea-bordered textarea-sm w-full font-mono text-xs leading-snug"
            />
          </div>

          <div>
            <span className="text-xs font-medium text-base-content/50">
              Import
            </span>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="paste a JSON array…"
              className="textarea textarea-bordered textarea-sm w-full font-mono text-xs leading-snug mt-1"
            />
            {modes && modes.length > 1 && (
              <div className="flex items-center gap-4 mt-2 text-xs">
                {modes.map((m) => (
                  <label
                    key={m}
                    className="inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="json-io-mode"
                      className="radio radio-xs"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    <span className="capitalize">{m}</span>
                  </label>
                ))}
              </div>
            )}
            {err && <p className="text-xs text-error mt-2">{err}</p>}
            {result && (
              <div className="text-xs mt-2 space-y-1">
                <p className="text-success">
                  Applied {result.applied}
                  {result.errors.length > 0
                    ? ` · ${result.errors.length} skipped`
                    : "."}
                </p>
                {result.errors.length > 0 && (
                  <ul className="text-warning list-disc pl-4">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy || !importText.trim()}
                className="btn btn-primary btn-sm"
              >
                {busy ? "Applying…" : "Apply import"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
