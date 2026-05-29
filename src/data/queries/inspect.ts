// Read queries for the Database page's Tables browser + SQL console.
// Generic table introspection over the live DuckDB (main + config schemas).

import { getDataSource } from "../select";

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export interface TableInfo {
  schema: string;
  name: string;
  rows: number;
}

// Internal/bookkeeping tables hidden from the browser by default.
const HIDDEN = new Set([
  "_migrations",
  "_publish_state",
  "_publish_meta",
  "config_meta",
]);

export async function listTables(): Promise<TableInfo[]> {
  const ds = getDataSource();
  const rows = await ds.query<{ table_schema: string; table_name: string }>({
    sql:
      "SELECT table_schema, table_name FROM information_schema.tables " +
      "WHERE table_schema IN ('main', 'config') ORDER BY table_schema, table_name",
  });
  const visible = rows.filter((r) => !HIDDEN.has(r.table_name));
  // Row counts per table (handful of tables — fine to count each).
  const out: TableInfo[] = [];
  for (const r of visible) {
    let n = 0;
    try {
      const [c] = await ds.query<{ n: number }>({
        sql: `SELECT COUNT(*) AS n FROM ${ident(r.table_schema)}.${ident(r.table_name)}`,
      });
      n = Number(c?.n ?? 0);
    } catch {
      n = 0;
    }
    out.push({ schema: r.table_schema, name: r.table_name, rows: n });
  }
  return out;
}

export interface TableSample {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

/** A capped sample of a table for the browser grid (client-side sort/filter/
 *  page over the sample). */
export async function sampleTable(
  schema: string,
  name: string,
  limit = 1000,
): Promise<TableSample> {
  const ds = getDataSource();
  const tbl = `${ident(schema)}.${ident(name)}`;
  const [c] = await ds.query<{ n: number }>({
    sql: `SELECT COUNT(*) AS n FROM ${tbl}`,
  });
  const total = Number(c?.n ?? 0);
  const rows = await ds.query<Record<string, unknown>>({
    sql: `SELECT * FROM ${tbl} LIMIT ${limit}`,
  });
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return { columns, rows, total, truncated: total > limit };
}

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/** Run an arbitrary SQL statement (SQL console). Caps the rendered rows.
 *  No read-only guard — dev tool; the local DB is disposable. */
export async function runSql(sql: string, cap = 1000): Promise<SqlResult> {
  const ds = getDataSource();
  const rows = await ds.query<Record<string, unknown>>({ sql });
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return {
    columns,
    rows: rows.slice(0, cap),
    truncated: rows.length > cap,
  };
}
