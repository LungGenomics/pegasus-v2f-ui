import type { DataSource } from "../types";
import type { Migration } from "./types";
import { migration as m001 } from "./001-redesigned-schema";

const ALL_MIGRATIONS: Migration[] = [m001].sort(
  (a, b) => a.version - b.version,
);

async function getAppliedVersions(ds: DataSource): Promise<Set<number>> {
  try {
    const rows = await ds.query<{ version: number }>({
      sql: "SELECT version FROM main._migrations ORDER BY version",
    });
    return new Set(rows.map((r) => Number(r.version)));
  } catch {
    // Table doesn't exist yet — first run.
    return new Set();
  }
}

export async function ensureSchema(ds: DataSource): Promise<void> {
  if (!ds.capabilities.canWrite) {
    // Read-only data source — skip migrations entirely.
    return;
  }
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
