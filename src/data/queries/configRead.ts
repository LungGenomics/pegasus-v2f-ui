import type { SqlQuery } from "../types";

// Reads against the new config.* schema. Writes use direct DataSource.exec
// from sourceOps so they can be sequenced (parent insert → children).

export const configReads = {
  allSources: (): SqlQuery => ({
    sql:
      "SELECT id, name, source_type, url, sheet, skip_rows, " +
      "       display_name, description, data_type, gene_column, " +
      "       include_in_search, row_version, updated_at " +
      "FROM config.source_configs " +
      "ORDER BY name",
  }),

  sourceByName: (name: string): SqlQuery => ({
    sql:
      "SELECT id, name, source_type, url, sheet, skip_rows, " +
      "       display_name, description, data_type, gene_column, " +
      "       include_in_search, row_version " +
      "FROM config.source_configs WHERE name = ? LIMIT 1",
    params: [name],
  }),

  sourceById: (id: string): SqlQuery => ({
    sql:
      "SELECT id, name, source_type, url, sheet, skip_rows, " +
      "       display_name, description, data_type, gene_column, " +
      "       include_in_search, row_version " +
      "FROM config.source_configs WHERE id = ? LIMIT 1",
    params: [id],
  }),

  transformsForSource: (sourceId: string): SqlQuery => ({
    sql:
      "SELECT id, seq, type, params " +
      "FROM config.source_transformations " +
      "WHERE source_id = ? ORDER BY seq",
    params: [sourceId],
  }),

  evidenceBlocksForSource: (sourceId: string): SqlQuery => ({
    sql:
      "SELECT id, source_tag, evidence_category, role, centric, fields " +
      "FROM config.source_evidence_blocks " +
      "WHERE source_id = ? ORDER BY source_tag",
    params: [sourceId],
  }),

  allStudies: (): SqlQuery => ({
    sql:
      "SELECT id, id_prefix, gwas_source, ancestry, sample_size, doi, year, " +
      "       loci_source, loci_sheet, loci_skip, gene_column, " +
      "       sentinel_column, pvalue_column, rsid_column, row_version " +
      "FROM config.study_configs ORDER BY id_prefix",
  }),

  traitsForStudy: (studyId: string): SqlQuery => ({
    sql:
      "SELECT trait, trait_description, trait_ontology_id " +
      "FROM config.study_traits WHERE study_id = ? ORDER BY trait",
    params: [studyId],
  }),

  pegasusSettings: (): SqlQuery => ({
    sql:
      "SELECT window_kb, merge_distance_kb, locus_definition_source, row_version " +
      "FROM config.pegasus_settings WHERE id = 1",
  }),
};
