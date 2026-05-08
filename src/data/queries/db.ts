import type { SqlQuery } from "../types";

export const dbQueries = {
  // List of standalone-mode-meaningful tables, with row counts. Excludes
  // the FTS index shadow tables and other internals.
  tables: (): SqlQuery => ({
    sql:
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'main' AND table_name NOT LIKE 'fts_%' " +
      "ORDER BY table_name",
  }),

  rowCount: (table: string): SqlQuery => ({
    sql: `SELECT COUNT(*) AS n FROM ${table.replace(/[^a-zA-Z0-9_]/g, "")}`,
  }),

  metaValue: (key: string): SqlQuery => ({
    sql: "SELECT value FROM _pegasus_meta WHERE key = ?",
    params: [key],
  }),

  hasTable: (table: string): SqlQuery => ({
    sql:
      "SELECT 1 AS x FROM information_schema.tables " +
      "WHERE table_schema = 'main' AND table_name = ?",
    params: [table],
  }),
};
