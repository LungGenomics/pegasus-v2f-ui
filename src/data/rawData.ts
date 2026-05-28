// Read-only access to a source's raw table (main.raw_<id>) for the
// Phase 2 grid: schema introspection, cheap per-column stats, and a
// paged/sorted/filtered window. All read-only — raw is provenance and
// is never edited in place (decision D5).

import { getDataSource, tableExists } from "./select";
import { rawTableName } from "./sourceOps";

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function strLit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export interface RawColumn {
  name: string;
  type: string;
}

export interface RawColumnStat {
  name: string;
  type: string;
  /** Fraction of NULLs, 0..1. */
  nullFrac: number;
  /** Approximate distinct count (approx_count_distinct). */
  distinct: number;
}

export interface RawColumnFilter {
  column: string;
  /** Case-insensitive substring match (ILIKE %v%). */
  contains: string;
}

export interface RawPageRequest {
  limit: number;
  offset: number;
  orderBy?: string;
  dir?: "asc" | "desc";
  filters?: RawColumnFilter[];
  /** Global case-insensitive substring search across the given columns
   *  (OR-joined), ANDed with any per-column `filters`. */
  search?: { query: string; columns: string[] };
}

export interface RawPage {
  rows: Record<string, unknown>[];
  total: number;
}

/** Does this source have a materialized raw table? */
export async function hasRawTable(sourceId: string): Promise<boolean> {
  return tableExists(rawTableName(sourceId));
}

/** Column names + DuckDB types, in ordinal order. */
export async function getRawSchema(sourceId: string): Promise<RawColumn[]> {
  const ds = getDataSource();
  const rows = await ds.query<{ column_name: string; data_type: string }>({
    sql:
      "SELECT column_name, data_type FROM information_schema.columns " +
      "WHERE table_schema = 'main' AND table_name = ? ORDER BY ordinal_position",
    params: [rawTableName(sourceId)],
  });
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

/** One-pass per-column null fraction + approx distinct count. Cheap
 *  even on wide tables (single aggregate scan). */
export async function getRawStats(
  sourceId: string,
): Promise<{ total: number; columns: RawColumnStat[] }> {
  const ds = getDataSource();
  const schema = await getRawSchema(sourceId);
  const tbl = `main.${ident(rawTableName(sourceId))}`;
  if (schema.length === 0) return { total: 0, columns: [] };

  const exprs = schema.flatMap((c, i) => [
    `COUNT(${ident(c.name)}) AS nn_${i}`,
    `approx_count_distinct(${ident(c.name)}) AS nd_${i}`,
  ]);
  const [row] = await ds.query<Record<string, number>>({
    sql: `SELECT COUNT(*) AS total, ${exprs.join(", ")} FROM ${tbl}`,
  });
  const total = Number(row?.total ?? 0);
  const columns = schema.map((c, i) => {
    const nonNull = Number(row?.[`nn_${i}`] ?? 0);
    return {
      name: c.name,
      type: c.type,
      nullFrac: total > 0 ? (total - nonNull) / total : 0,
      distinct: Number(row?.[`nd_${i}`] ?? 0),
    };
  });
  return { total, columns };
}

/** A page of raw rows with optional sort + per-column ILIKE filters,
 *  all pushed down to SQL. Offset paging — raw tables are bounded
 *  (one sheet/file); keyset paging is a later optimization. */
export async function getRawPage(
  sourceId: string,
  req: RawPageRequest,
): Promise<RawPage> {
  const ds = getDataSource();
  const tbl = `main.${ident(rawTableName(sourceId))}`;

  const clauses: string[] = [];
  for (const f of req.filters ?? []) {
    if (f.contains.trim() === "") continue;
    clauses.push(
      `CAST(${ident(f.column)} AS VARCHAR) ILIKE ${strLit(`%${f.contains}%`)}`,
    );
  }
  if (
    req.search &&
    req.search.query.trim() !== "" &&
    req.search.columns.length > 0
  ) {
    const q = req.search.query.trim();
    const inner = req.search.columns
      .map((c) => `CAST(${ident(c)} AS VARCHAR) ILIKE ${strLit(`%${q}%`)}`)
      .join(" OR ");
    clauses.push(`(${inner})`);
  }
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const order = req.orderBy
    ? `ORDER BY ${ident(req.orderBy)} ${req.dir === "desc" ? "DESC" : "ASC"}`
    : "";
  const limit = Math.max(1, Math.min(req.limit, 1000));
  const offset = Math.max(0, req.offset);

  const [{ n } = { n: 0 }] = await ds.query<{ n: number }>({
    sql: `SELECT COUNT(*) AS n FROM ${tbl} ${whereClause}`,
  });
  const rows = await ds.query<Record<string, unknown>>({
    sql: `SELECT * FROM ${tbl} ${whereClause} ${order} LIMIT ${limit} OFFSET ${offset}`,
  });
  return { rows, total: Number(n ?? 0) };
}

