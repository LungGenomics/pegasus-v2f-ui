import type { DataSource } from "../types";
import type { Migration } from "./types";

// Derived-layer settings (Explore data layer, plan 2026-05-28). Adds two
// columns to config.pegasus_settings:
//   - gene_reference_url      — R2 URL of the hg38 gene-coordinate parquet,
//     loaded once per session into main.gene_reference (not a source).
//   - candidate_gene_biotypes — comma list filtering which gene biotypes
//     count as a locus's candidate genes (empty = all). Default keeps it to
//     protein_coding + lncRNA so a 500kb window doesn't pull in every
//     pseudogene.
//
// Migration 001 was updated to include these in fresh DBs; this migration is
// for DBs that pre-date the edit (CREATE TABLE IF NOT EXISTS no-ops on an
// existing table). ADD COLUMN IF NOT EXISTS is idempotent.
//
// The derived relations themselves (main.evidence / main.loci /
// main.locus_evidence / main.gene_reference) are created by the build
// functions, NOT here — they depend on the live mapping set + settings.

const STATEMENTS: string[] = [
  `ALTER TABLE config.pegasus_settings
     ADD COLUMN IF NOT EXISTS gene_reference_url VARCHAR`,
  `ALTER TABLE config.pegasus_settings
     ADD COLUMN IF NOT EXISTS candidate_gene_biotypes VARCHAR DEFAULT 'protein_coding,lncRNA'`,
];

const apply = async (ds: DataSource): Promise<void> => {
  for (let i = 0; i < STATEMENTS.length; i++) {
    const stmt = STATEMENTS[i]!;
    const label = stmt.trim().split(/\s+/).slice(0, 6).join(" ");
    try {
      await ds.exec({ sql: stmt });
    } catch (err) {
      console.error(
        `[migration 004] statement ${i + 1}/${STATEMENTS.length} failed: ${label}…`,
        err,
      );
      throw err;
    }
  }
};

export const migration: Migration = {
  version: 4,
  name: "derived_layer_settings",
  apply,
};
