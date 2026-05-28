import type { DataSource } from "../types";
import type { Migration } from "./types";

// Audit columns on the editable config entities (sources, mappings, traits).
// `created_by` / `last_edited_by` carry the GitHub login of the actor whose
// session triggered the write — NULL when the write happened without a
// signed-in session (local-first is preserved; the audit just stays empty).
//
// Migration 001 was updated to include these columns in fresh DBs; this
// migration is for DBs that pre-date the edit (CREATE TABLE IF NOT EXISTS
// is a no-op on an existing table). ADD COLUMN IF NOT EXISTS is idempotent
// so re-running is safe.

const STATEMENTS: string[] = [
  `ALTER TABLE config.sources  ADD COLUMN IF NOT EXISTS created_by      VARCHAR`,
  `ALTER TABLE config.sources  ADD COLUMN IF NOT EXISTS last_edited_by  VARCHAR`,
  `ALTER TABLE config.mappings ADD COLUMN IF NOT EXISTS created_by      VARCHAR`,
  `ALTER TABLE config.mappings ADD COLUMN IF NOT EXISTS last_edited_by  VARCHAR`,
  `ALTER TABLE config.traits   ADD COLUMN IF NOT EXISTS created_by      VARCHAR`,
  `ALTER TABLE config.traits   ADD COLUMN IF NOT EXISTS last_edited_by  VARCHAR`,
];

const apply = async (ds: DataSource): Promise<void> => {
  for (let i = 0; i < STATEMENTS.length; i++) {
    const stmt = STATEMENTS[i]!;
    const label = stmt.trim().split(/\s+/).slice(0, 6).join(" ");
    try {
      await ds.exec({ sql: stmt });
    } catch (err) {
      console.error(
        `[migration 003] statement ${i + 1}/${STATEMENTS.length} failed: ${label}…`,
        err,
      );
      throw err;
    }
  }
};

export const migration: Migration = {
  version: 3,
  name: "audit_columns",
  apply,
};
