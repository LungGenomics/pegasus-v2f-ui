import type { SqlQuery } from "../types";

export const sourcesQueries = {
  // Stored config blob — caller parses YAML and reads `data_sources`
  storedConfig: (): SqlQuery => ({
    sql: "SELECT value FROM _pegasus_meta WHERE key = 'config'",
  }),

  provenance: (): SqlQuery => ({
    sql:
      "SELECT source_tag, source_name, source_type, evidence_category, " +
      "is_integrated, version, url, citation, date_imported, record_count " +
      "FROM data_sources ORDER BY evidence_category, source_tag",
  }),

  evidenceLoci: (sourceTag: string): SqlQuery => ({
    sql:
      "SELECT l.locus_id, l.locus_name, l.chromosome, " +
      "l.start_position, l.end_position, l.lead_pvalue, " +
      "COUNT(DISTINCT se.gene_symbol) AS n_genes, " +
      "MAX(se.score) AS max_score " +
      "FROM scored_evidence se " +
      "JOIN loci l ON se.locus_id = l.locus_id " +
      "WHERE se.source_tag = ? " +
      "GROUP BY l.locus_id, l.locus_name, l.chromosome, " +
      "l.start_position, l.end_position, l.lead_pvalue " +
      "ORDER BY l.chromosome, l.start_position",
    params: [sourceTag],
  }),

  evidenceRows: (sourceTag: string): SqlQuery => ({
    sql:
      "SELECT se.locus_id, l.locus_name, se.study_id, " +
      "se.gene_symbol, " +
      "se.evidence_category, se.pvalue, se.effect_size, se.score, " +
      "se.tissue, se.cell_type, se.ancestry, se.sex, se.rsid " +
      "FROM scored_evidence se " +
      "JOIN loci l ON se.locus_id = l.locus_id " +
      "WHERE se.source_tag = ? " +
      "ORDER BY l.chromosome, l.start_position, se.gene_symbol",
    params: [sourceTag],
  }),

  positionCount: (sourceTag: string): SqlQuery => ({
    sql:
      "SELECT COUNT(*) AS n FROM evidence " +
      "WHERE source_tag = ? AND chromosome IS NOT NULL " +
      "AND CAST(chromosome AS VARCHAR) != '-'",
    params: [sourceTag],
  }),

  variants: (sourceTag: string): SqlQuery => ({
    sql:
      "SELECT e.chromosome, e.position, e.rsid, e.gene_symbol, " +
      "e.pvalue, e.effect_size, e.score, e.tissue, e.cell_type " +
      "FROM evidence e " +
      "WHERE e.source_tag = ? " +
      "AND e.chromosome IS NOT NULL AND CAST(e.chromosome AS VARCHAR) != '-' " +
      "ORDER BY e.chromosome, e.position",
    params: [sourceTag],
  }),

  // Source rollup for a trait: which sources contributed scored evidence
  // for any study under this trait, grouped by source_tag + category.
  // LEGACY path — joins through `studies.trait` (string match) since the
  // CLI schema doesn't carry trait identity on scored_evidence. Kept as
  // a fallback for CLI-built DBs; redesigned builds use sourcesForTraitId.
  sourcesForTrait: (trait: string): SqlQuery => ({
    sql:
      "SELECT se.source_tag, se.evidence_category, " +
      "       COUNT(*) AS record_count, " +
      "       COUNT(DISTINCT se.gene_symbol) AS n_genes, " +
      "       COUNT(DISTINCT se.locus_id) AS n_loci " +
      "FROM scored_evidence se " +
      "JOIN studies s ON s.study_id = se.study_id " +
      "WHERE s.trait = ? " +
      "GROUP BY se.source_tag, se.evidence_category " +
      "ORDER BY se.evidence_category, record_count DESC",
    params: [trait],
  }),

  // Redesigned path — scored_evidence carries the canonical trait_id
  // (populated by materialize.ts), so we group by source directly with
  // no legacy `studies` join and no fragile string match.
  sourcesForTraitId: (traitId: string): SqlQuery => ({
    sql:
      "SELECT se.source_tag, se.evidence_category, " +
      "       COUNT(*) AS record_count, " +
      "       COUNT(DISTINCT se.gene_symbol) AS n_genes, " +
      "       COUNT(DISTINCT se.locus_id) AS n_loci " +
      "FROM scored_evidence se " +
      "WHERE se.trait_id = ? " +
      "GROUP BY se.source_tag, se.evidence_category " +
      "ORDER BY se.evidence_category, record_count DESC",
    params: [traitId],
  }),
};
