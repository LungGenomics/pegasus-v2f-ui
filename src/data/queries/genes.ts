import type { SqlQuery } from "../types";

// Modern schema assumed: gene_symbol column on gene_search_index, n_loci/
// n_studies/best_rank populated when the DB has been scored. Older DBs that
// only have a `gene` column won't work here — they need a one-time migration
// (or use REST mode against a server that does runtime introspection).
const SCORED_FILTER = "n_loci IS NOT NULL AND n_loci > 0";
const SCORED_ORDER =
  "n_studies DESC NULLS LAST, n_loci DESC, best_rank ASC NULLS LAST";

export const genesQueries = {
  // Single gene detail. Falls back from `genes` table to `gene_search_index`
  // if the gene exists in evidence but isn't in the annotated genes table.
  // Returns up to 2 result sets — caller picks first non-empty.
  detailFromGenes: (gene: string): SqlQuery => ({
    sql: "SELECT * FROM genes WHERE gene_symbol = ?",
    params: [gene],
  }),

  detailFromSearchIndex: (gene: string): SqlQuery => ({
    sql: "SELECT * FROM gene_search_index WHERE gene_symbol = ?",
    params: [gene],
  }),

  // All evidence rows for one gene (variant-level + gene-level mixed)
  evidence: (gene: string): SqlQuery => ({
    sql:
      "SELECT gene_symbol, chromosome, position, rsid, evidence_category, " +
      "source_tag, trait, pvalue, effect_size, score, tissue, cell_type, " +
      "ancestry, sex, evidence_stream, is_supporting " +
      "FROM evidence WHERE gene_symbol = ?",
    params: [gene],
  }),

  // Gene search — paginated, optionally filtered to scored-only.
  // Portable subset of the FastAPI route: ILIKE on gene_symbol and
  // searchable_text. DuckDB's FTS index path is server-only.
  search: (opts: {
    search: string;
    limit: number;
    offset: number;
    scoredOnly: boolean;
  }): SqlQuery => {
    const { search, limit, offset, scoredOnly } = opts;
    const filters: string[] = [];
    const params: unknown[] = [];
    if (search) {
      filters.push("(gene_symbol ILIKE ? OR searchable_text ILIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (scoredOnly) filters.push(SCORED_FILTER);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const order = scoredOnly ? SCORED_ORDER : "gene_symbol";
    return {
      sql: `SELECT *, gene_symbol AS gene FROM gene_search_index ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      params: [...params, limit, offset],
    };
  },

  searchCount: (opts: { search: string; scoredOnly: boolean }): SqlQuery => {
    const { search, scoredOnly } = opts;
    const filters: string[] = [];
    const params: unknown[] = [];
    if (search) {
      filters.push("(gene_symbol ILIKE ? OR searchable_text ILIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (scoredOnly) filters.push(SCORED_FILTER);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return {
      sql: `SELECT COUNT(*) AS n FROM gene_search_index ${where}`,
      params,
    };
  },

  // Locus scores for a gene — one row per locus, joined with locus geom.
  // Phase 7: trait identity comes straight off scored_evidence (`s.trait`,
  // which the redesigned pipeline sets from the canonical config.traits
  // label resolved via trait_id; legacy CLI DBs also carry it). The old
  // `LEFT JOIN studies st ON l.study_id` path is dropped — redesigned
  // builds don't populate study_id, so that join silently lost all rows.
  scores: (gene: string): SqlQuery => ({
    sql:
      "SELECT DISTINCT s.locus_id, s.gene_symbol, s.integration_rank, " +
      "s.is_predicted_effector, s.match_type, s.n_candidate_genes, " +
      "l.locus_name, l.chromosome, l.start_position, l.end_position, " +
      "s.study_id, s.trait " +
      "FROM scored_evidence s " +
      "JOIN loci l ON s.locus_id = l.locus_id " +
      "WHERE s.gene_symbol = ? " +
      "ORDER BY s.integration_rank",
    params: [gene],
  }),
};
