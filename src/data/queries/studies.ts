import type { SqlQuery } from "../types";

export const studiesQueries = {
  list: (): SqlQuery => ({
    sql:
      "SELECT study_id, trait, trait_description, trait_ontology_id, " +
      "study_description, gwas_source, ancestry, sample_size, doi, year, n_loci " +
      "FROM studies ORDER BY trait",
  }),

  detail: (studyId: string): SqlQuery => ({
    sql: "SELECT * FROM studies WHERE study_id = ?",
    params: [studyId],
  }),

  // Aggregate counts for a study detail view
  countLoci: (studyId: string): SqlQuery => ({
    sql: "SELECT COUNT(*) AS n FROM loci WHERE study_id = ?",
    params: [studyId],
  }),

  countCandidateGenes: (studyId: string): SqlQuery => ({
    sql:
      "SELECT COUNT(DISTINCT gene_symbol) AS n FROM scored_evidence " +
      "WHERE study_id = ?",
    params: [studyId],
  }),

  countEffectors: (studyId: string): SqlQuery => ({
    sql:
      "SELECT COUNT(DISTINCT gene_symbol) AS n FROM scored_evidence " +
      "WHERE study_id = ? AND is_predicted_effector = TRUE",
    params: [studyId],
  }),

  evidenceCategories: (studyId: string): SqlQuery => ({
    sql:
      "SELECT DISTINCT evidence_category FROM scored_evidence " +
      "WHERE study_id = ? AND evidence_category IS NOT NULL " +
      "ORDER BY evidence_category",
    params: [studyId],
  }),

  // All loci across all studies (cross-study list)
  allLoci: (limit: number): SqlQuery => ({
    sql:
      "SELECT l.locus_id, l.locus_name, l.chromosome, l.start_position, " +
      "l.end_position, l.lead_rsid, l.lead_pvalue, l.n_candidate_genes, " +
      "l.study_id, s.trait, " +
      "sc.gene_symbol AS top_gene " +
      "FROM loci l " +
      "LEFT JOIN studies s ON l.study_id = s.study_id " +
      "LEFT JOIN (SELECT DISTINCT locus_id, gene_symbol, integration_rank " +
      "FROM scored_evidence WHERE integration_rank = 1) sc ON l.locus_id = sc.locus_id " +
      "ORDER BY l.chromosome, l.start_position " +
      "LIMIT ?",
    params: [limit],
  }),

  studyLoci: (studyId: string): SqlQuery => ({
    sql:
      "SELECT l.locus_id, l.locus_name, l.chromosome, l.start_position, l.end_position, " +
      "l.lead_variant_id, l.lead_rsid, l.lead_pvalue, l.locus_source, " +
      "l.n_signals, l.n_candidate_genes, l.nearest_gene, " +
      "s.gene_symbol AS top_gene " +
      "FROM loci l " +
      "LEFT JOIN (SELECT DISTINCT locus_id, gene_symbol, integration_rank " +
      "FROM scored_evidence WHERE integration_rank = 1) s ON l.locus_id = s.locus_id " +
      "WHERE l.study_id = ? ORDER BY l.chromosome, l.start_position",
    params: [studyId],
  }),

  studyEffectors: (studyId: string): SqlQuery => ({
    sql:
      "SELECT l.locus_id, l.locus_name, l.chromosome, l.start_position, l.end_position, " +
      "s.gene_symbol, s.integration_rank, s.is_predicted_effector " +
      "FROM (SELECT DISTINCT locus_id, study_id, gene_symbol, integration_rank, is_predicted_effector " +
      "FROM scored_evidence WHERE integration_rank = 1) s " +
      "JOIN loci l ON s.locus_id = l.locus_id " +
      "WHERE s.study_id = ? " +
      "ORDER BY l.chromosome, l.start_position",
    params: [studyId],
  }),

  // Evidence rows for a single locus — caller groups by gene client-side
  locusGenesRaw: (locusId: string): SqlQuery => ({
    sql:
      "SELECT gene_symbol, evidence_category, source_tag, trait, " +
      "pvalue, effect_size, score, tissue, cell_type, rsid, " +
      "ancestry, sex, " +
      "match_type, integration_rank, is_predicted_effector, n_candidate_genes " +
      "FROM scored_evidence " +
      "WHERE locus_id = ? " +
      "ORDER BY integration_rank, evidence_category",
    params: [locusId],
  }),
};
