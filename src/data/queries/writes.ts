import type { SqlQuery } from "../types";

// SQL builders for the plain-write surface. Each one returns a single
// statement; multi-step cascades (like source delete) are sequenced by the
// caller so they go through the active DataSource's exec().

const sanitizeIdent = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "");

export const writes = {
  setMeta: (key: string, value: string): SqlQuery => ({
    sql:
      "INSERT INTO _pegasus_meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    params: [key, value],
  }),

  dropTable: (table: string): SqlQuery => ({
    // Identifier interpolation — SQL builders never accept raw user input
    // here; callers pass internal table names.
    sql: `DROP TABLE IF EXISTS "${sanitizeIdent(table)}"`,
  }),

  deleteEvidenceBySourceTag: (sourceTag: string): SqlQuery => ({
    sql: "DELETE FROM evidence WHERE source_tag = ?",
    params: [sourceTag],
  }),

  deleteScoredEvidenceBySourceTag: (sourceTag: string): SqlQuery => ({
    sql: "DELETE FROM scored_evidence WHERE source_tag = ?",
    params: [sourceTag],
  }),

  deleteDataSourceBySourceTag: (sourceTag: string): SqlQuery => ({
    sql: "DELETE FROM data_sources WHERE source_tag = ?",
    params: [sourceTag],
  }),

  deleteSourceMetadata: (tableName: string): SqlQuery => ({
    sql: "DELETE FROM source_metadata WHERE table_name = ?",
    params: [tableName],
  }),

  // Locus-definition cascade — drops orphaned scored_evidence rows referencing
  // loci that came from the removed source, then orphaned loci/studies.
  deleteOrphanedScoredEvidence: (sourceTag: string): SqlQuery => ({
    sql:
      "DELETE FROM scored_evidence WHERE locus_id IN (" +
      "  SELECT locus_id FROM loci WHERE study_id IN (" +
      "    SELECT study_id FROM studies WHERE source_tag = ?" +
      "  )" +
      ")",
    params: [sourceTag],
  }),

  deleteOrphanedLoci: (sourceTag: string): SqlQuery => ({
    sql:
      "DELETE FROM loci WHERE study_id IN (" +
      "  SELECT study_id FROM studies WHERE source_tag = ?" +
      ")",
    params: [sourceTag],
  }),

  deleteStudiesBySourceTag: (sourceTag: string): SqlQuery => ({
    sql: "DELETE FROM studies WHERE source_tag = ?",
    params: [sourceTag],
  }),
};

export const rawTableName = (sourceName: string) =>
  `raw_${sanitizeIdent(sourceName)}`;
