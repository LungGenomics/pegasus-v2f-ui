import type { DataSource } from "../types";
import type { Migration } from "./types";
import { migration as m001 } from "./001-redesigned-schema";

// Single base schema — 001 folds in every former incremental migration
// (002 publish-tracker, 003 audit-columns, 004 derived-layer-settings).
const ALL_MIGRATIONS: Migration[] = [m001];

async function ensureMigrationsTable(ds: DataSource): Promise<void> {
  // Bootstrap step — runs before any migration so the SELECT below
  // always works. CREATE TABLE IF NOT EXISTS is idempotent.
  await ds.exec({
    sql: `CREATE TABLE IF NOT EXISTS main._migrations (
            version    INTEGER PRIMARY KEY,
            name       VARCHAR NOT NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT now(),
            checksum   VARCHAR
          )`,
  });
}

async function getAppliedVersions(ds: DataSource): Promise<Set<number>> {
  const rows = await ds.query<{ version: number }>({
    sql: "SELECT version FROM main._migrations ORDER BY version",
  });
  return new Set(rows.map((r) => Number(r.version)));
}

export async function ensureSchema(ds: DataSource): Promise<void> {
  if (!ds.capabilities.canWrite) {
    // Read-only data source — skip migrations entirely.
    return;
  }
  await ensureMigrationsTable(ds);
  const applied = await getAppliedVersions(ds);
  for (const m of ALL_MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      await m.apply(ds);
      await ds.exec({
        sql: "INSERT INTO main._migrations (version, name) VALUES (?, ?)",
        params: [m.version, m.name],
      });
    } catch (err) {
      console.error(
        `Migration ${m.version} (${m.name}) failed:`,
        err,
      );
      throw err;
    }
  }
}
