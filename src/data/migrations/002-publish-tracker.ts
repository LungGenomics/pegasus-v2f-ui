import type { DataSource } from "../types";
import type { Migration } from "./types";

// Phase 4 of the source-workspace restructure: local dirty-tracker for
// the explicit-Publish model (plan 2026-05-19). Adds:
//   - config.sources.raw_version — bumped on each (re)ingest; raw-table
//     mutations don't touch the config row, so they need their own
//     counter to register in a source's content signature.
//   - config._publish_state — per-source { sig } snapshot taken at the
//     last Publish (or at shared-DB load = the published baseline). A
//     source is "dirty" when its current sig differs, or when a
//     _publish_state row has no matching source (deleted since
//     publish). The tracker lives IN the DB so it rides inside every
//     snapshot — Discard (re-pull last published) restores a
//     consistent tracker for free.
//   - config._publish_meta — single row: the last published R2 version
//     key + timestamp (populated by Phase 5 Publish; nullable here).

const STATEMENTS: string[] = [
  `ALTER TABLE config.sources ADD COLUMN IF NOT EXISTS raw_version INTEGER DEFAULT 0`,

  `CREATE TABLE IF NOT EXISTS config._publish_state (
     source_id    UUID PRIMARY KEY,
     sig          VARCHAR NOT NULL,
     published_at TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS config._publish_meta (
     id           INTEGER PRIMARY KEY DEFAULT 1,
     version_key  VARCHAR,
     published_at TIMESTAMP
   )`,
];

const apply = async (ds: DataSource): Promise<void> => {
  for (let i = 0; i < STATEMENTS.length; i++) {
    const stmt = STATEMENTS[i]!;
    const label = stmt.trim().split(/\s+/).slice(0, 6).join(" ");
    try {
      await ds.exec({ sql: stmt });
    } catch (err) {
      console.error(
        `[migration 002] statement ${i + 1}/${STATEMENTS.length} failed: ${label}…`,
        err,
      );
      throw err;
    }
  }
};

export const migration: Migration = {
  version: 2,
  name: "publish_tracker",
  apply,
};
