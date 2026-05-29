// Tables browser (Database page). Pick a table → a capped, sortable/filterable
// grid of its rows. Reuses the Explore DataTable for the grid.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listTables, sampleTable } from "../../data/queries/inspect";
import { DataTable, type Column } from "../../pages/explore/data-table";

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function TableBrowser() {
  const tablesQ = useQuery({ queryKey: ["inspect", "tables"], queryFn: listTables });
  const tables = tablesQ.data ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  // Default to the first table once loaded.
  useEffect(() => {
    if (!picked && tables.length > 0) {
      setPicked(`${tables[0]!.schema}.${tables[0]!.name}`);
    }
  }, [tables, picked]);

  const [schema, name] = (picked ?? ".").split(".");
  const sampleQ = useQuery({
    queryKey: ["inspect", "sample", picked],
    queryFn: () => sampleTable(schema!, name!, 1000),
    enabled: !!picked && !!name,
  });
  const sample = sampleQ.data;

  const columns: Column<Record<string, unknown>>[] = (sample?.columns ?? []).map(
    (c) => ({ key: c, header: c, value: (r) => fmtCell(r[c]), mono: true }),
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <select
          value={picked ?? ""}
          onChange={(e) => setPicked(e.target.value)}
          className="select select-bordered select-sm font-mono text-xs"
        >
          {tables.map((t) => (
            <option key={`${t.schema}.${t.name}`} value={`${t.schema}.${t.name}`}>
              {t.schema}.{t.name} ({t.rows.toLocaleString()})
            </option>
          ))}
        </select>
        {sample?.truncated && (
          <span className="text-xs text-base-content/40">
            showing first 1,000 of {sample.total.toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {sampleQ.isLoading ? (
          <p className="text-sm text-base-content/40">Loading…</p>
        ) : (
          <DataTable
            rows={sample?.rows ?? []}
            columns={columns}
            filterKeys={sample?.columns ?? []}
            filterPlaceholder="Filter rows…"
            emptyMessage="Empty table."
          />
        )}
      </div>
    </div>
  );
}
