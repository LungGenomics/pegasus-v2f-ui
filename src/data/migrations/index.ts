import type { DataSource } from "../types";
import type { Migration } from "./types";
import { migration as m001 } from "./001-redesigned-schema";
import { migration as m002 } from "./002-publish-tracker";
import { migration as m003 } from "./003-audit-columns";
import { migration as m004 } from "./004-derived-layer-settings";

const ALL_MIGRATIONS: Migration[] = [m001, m002, m003, m004].sort(
  (a, b) => a.version - b.version,
);

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
