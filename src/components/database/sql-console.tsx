// SQL console (Database page). Run arbitrary SQL against the local DuckDB and
// render the result. No read-only guard — it's a dev tool and the local DB is
// disposable (nuke + recreate). Results capped for rendering.

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { runSql, type SqlResult } from "../../data/queries/inspect";
import { DataTable, type Column } from "../../pages/explore/data-table";

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function SqlConsole() {
  const [sql, setSql] = useState("SELECT * FROM main.locus_evidence LIMIT 50;");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = sql.trim().replace(/;\s*$/, "");
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await runSql(q, 1000));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Record<string, unknown>>[] = (result?.columns ?? []).map(
    (c) => ({ key: c, header: c, value: (r) => fmtCell(r[c]), mono: true }),
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter to run.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void run();
          }
        }}
        spellCheck={false}
        rows={5}
        className="textarea textarea-bordered w-full font-mono text-xs leading-snug shrink-0"
        placeholder="SELECT … "
      />
      <div className="flex items-center gap-3 mt-2 shrink-0">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="btn btn-neutral btn-sm gap-1"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run
        </button>
        <span className="text-xs text-base-content/40">⌘/Ctrl + Enter</span>
        {result && (
          <span className="text-xs text-base-content/40 ml-auto">
            {result.rows.length.toLocaleString()} rows
            {result.truncated ? " (capped at 1,000)" : ""}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-error break-words mt-2 font-mono">{error}</p>
      )}

      {result && !error && (
        <div className="flex-1 min-h-0 mt-3">
          {result.columns.length === 0 ? (
            <p className="text-sm text-base-content/40">
              Query ran — no rows returned.
            </p>
          ) : (
            <DataTable
              rows={result.rows}
              columns={columns}
              filterKeys={result.columns}
              filterPlaceholder="Filter results…"
              emptyMessage="No rows."
            />
          )}
        </div>
      )}
    </div>
  );
}
