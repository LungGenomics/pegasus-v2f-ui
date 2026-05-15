// Materialize scored_evidence — port of cli/src/pegasus_v2f/scoring.py.
//
// Strategy: do the whole join+score as a series of CREATE OR REPLACE TABLE
// staging tables, then INSERT into scored_evidence. SQL beats Python's
// per-locus loop here — DuckDB handles the joins natively.
//
// Algorithm:
//   1. Candidate genes per locus = genes whose coords overlap the locus window.
//   2. Variant-level evidence per locus = evidence rows with chr+pos in window.
//   3. Gene-level evidence per locus = evidence rows (chromosome IS NULL)
//      for genes that are either candidates OR appear in variant evidence
//      for that locus.
//   4. Score = COUNT(DISTINCT evidence_category) per (locus, gene).
//   5. Rank = ROW_NUMBER() per locus by score DESC.
//   6. is_predicted_effector = score / max(score per locus) >= 0.25.
//   7. Stub rows for candidates with no evidence (so the genes still appear
//      under their locus).

import { getDataSource } from "../select";

const MAIN_SCORED_DDL = `CREATE TABLE IF NOT EXISTS main.scored_evidence (
  locus_id           VARCHAR,
  loci_source_id     UUID,
  loci_derivation_id UUID,
  gene_symbol        VARCHAR,
  evidence_category  VARCHAR,
  source_tag         VARCHAR,
  trait              VARCHAR,
  trait_id           UUID,
  pvalue             DOUBLE,
  effect_size        DOUBLE,
  score              DOUBLE,
  tissue             VARCHAR,
  cell_type          VARCHAR,
  rsid               VARCHAR,
  ancestry           VARCHAR,
  sex                VARCHAR,
  match_type         VARCHAR,
  integration_rank   INTEGER,
  is_predicted_effector BOOLEAN,
  n_candidate_genes  INTEGER
)`;

// CLI-built gene.duckdb may already have main.scored_evidence with the
// legacy shape (study_id, no loci_source_id / loci_derivation_id /
// trait_id). CREATE TABLE IF NOT EXISTS no-ops, so ALTER ADD COLUMN
// IF NOT EXISTS each column — idempotent, non-destructive.
const SCORED_COLUMNS: Array<[string, string]> = [
  ["locus_id", "VARCHAR"],
  ["loci_source_id", "UUID"],
  ["loci_derivation_id", "UUID"],
  ["gene_symbol", "VARCHAR"],
  ["evidence_category", "VARCHAR"],
  ["source_tag", "VARCHAR"],
  ["trait", "VARCHAR"],
  ["trait_id", "UUID"],
  ["pvalue", "DOUBLE"],
  ["effect_size", "DOUBLE"],
  ["score", "DOUBLE"],
  ["tissue", "VARCHAR"],
  ["cell_type", "VARCHAR"],
  ["rsid", "VARCHAR"],
  ["ancestry", "VARCHAR"],
  ["sex", "VARCHAR"],
  ["match_type", "VARCHAR"],
  ["integration_rank", "INTEGER"],
  ["is_predicted_effector", "BOOLEAN"],
  ["n_candidate_genes", "INTEGER"],
];

async function ensureScoredSchema(
  ds: ReturnType<typeof getDataSource>,
): Promise<void> {
  await ds.exec({ sql: MAIN_SCORED_DDL });
  for (const [col, type] of SCORED_COLUMNS) {
    await ds.exec({
      sql: `ALTER TABLE main.scored_evidence ADD COLUMN IF NOT EXISTS ${col} ${type}`,
    });
  }
}

const STAGING = {
  candidates: "main._matr_candidates",
  variantEv: "main._matr_variant_ev",
  geneEv: "main._matr_gene_ev",
  allEv: "main._matr_all_ev",
  scores: "main._matr_scores",
  candidateCounts: "main._matr_candidate_counts",
};

export type MaterializeResult = {
  scored_rows: number;
  loci: number;
};

export async function materializeScoredEvidence(): Promise<MaterializeResult> {
  const ds = getDataSource();
  await ensureScoredSchema(ds);

  // 0. Sanity: required upstream tables exist. scored_evidence is
  // created above if missing; loci/evidence are populated by the
  // route+loci pipeline steps; genes must be loaded separately (CLI
  // build artifact for now).
  for (const t of ["loci", "evidence", "genes"]) {
    try {
      await ds.query({ sql: `SELECT 1 FROM main.${t} LIMIT 0` });
    } catch {
      throw new Error(
        `Cannot materialize: table main.${t} not found. Run import + loci derivation first.`,
      );
    }
  }

  // 1. Clear scored_evidence
  await ds.exec({ sql: "DELETE FROM main.scored_evidence" });

  // 2. Candidates by geometry: gene coords overlap locus window.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.candidates} AS ` +
      `SELECT DISTINCT l.locus_id, g.gene_symbol ` +
      `FROM main.loci l ` +
      `JOIN main.genes g ` +
      `  ON g.chromosome = l.chromosome ` +
      `  AND g.start_position <= l.end_position ` +
      `  AND g.end_position >= l.start_position ` +
      `WHERE g.gene_symbol IS NOT NULL`,
  });

  // 3. Variant-level evidence in window.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.variantEv} AS ` +
      `SELECT l.locus_id, l.loci_source_id, l.loci_derivation_id, ` +
      `       e.gene_symbol, e.evidence_category, e.source_tag, ` +
      `       e.trait, e.trait_id, ` +
      `       e.pvalue, e.effect_size, e.score, e.tissue, e.cell_type, ` +
      `       e.rsid, e.ancestry, e.sex, ` +
      `       'position' AS match_type ` +
      `FROM main.loci l ` +
      `JOIN main.evidence e ` +
      `  ON e.chromosome = l.chromosome ` +
      `  AND e.position >= l.start_position ` +
      `  AND e.position <= l.end_position ` +
      `WHERE e.chromosome IS NOT NULL AND e.position IS NOT NULL`,
  });

  // 4. Gene-level evidence: rows where chromosome IS NULL, joined to loci by
  //    gene symbol where the gene is either a candidate or appears in variant
  //    evidence for that locus.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.geneEv} AS ` +
      `WITH locus_genes AS (` +
      `  SELECT locus_id, gene_symbol FROM ${STAGING.candidates} ` +
      `  UNION ` +
      `  SELECT DISTINCT locus_id, gene_symbol FROM ${STAGING.variantEv}` +
      `) ` +
      `SELECT lg.locus_id, l.loci_source_id, l.loci_derivation_id, ` +
      `       e.gene_symbol, e.evidence_category, e.source_tag, ` +
      `       e.trait, e.trait_id, ` +
      `       e.pvalue, e.effect_size, e.score, e.tissue, e.cell_type, ` +
      `       e.rsid, e.ancestry, e.sex, ` +
      `       'gene' AS match_type ` +
      `FROM locus_genes lg ` +
      `JOIN main.loci l ON l.locus_id = lg.locus_id ` +
      `JOIN main.evidence e ON e.gene_symbol = lg.gene_symbol AND e.chromosome IS NULL`,
  });

  // 5. Union of all evidence assigned to loci.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.allEv} AS ` +
      `SELECT * FROM ${STAGING.variantEv} UNION ALL SELECT * FROM ${STAGING.geneEv}`,
  });

  // 6. Per-locus per-gene score = distinct categories. Rank by score DESC.
  //    is_predicted_effector via score / MAX(score) per locus.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.scores} AS ` +
      `WITH base AS (` +
      `  SELECT locus_id, gene_symbol, ` +
      `         COUNT(DISTINCT evidence_category) AS gene_score ` +
      `  FROM ${STAGING.allEv} ` +
      `  GROUP BY locus_id, gene_symbol` +
      `) ` +
      `SELECT locus_id, gene_symbol, gene_score, ` +
      `       ROW_NUMBER() OVER (PARTITION BY locus_id ORDER BY gene_score DESC) AS integration_rank, ` +
      `       (gene_score >= 0.25 * MAX(gene_score) OVER (PARTITION BY locus_id)) AS is_predicted_effector ` +
      `FROM base`,
  });

  // 7. Per-locus candidate gene count (candidates ∪ evidence genes).
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE ${STAGING.candidateCounts} AS ` +
      `SELECT locus_id, COUNT(DISTINCT gene_symbol) AS n_candidate_genes FROM (` +
      `  SELECT locus_id, gene_symbol FROM ${STAGING.candidates} ` +
      `  UNION ` +
      `  SELECT locus_id, gene_symbol FROM ${STAGING.allEv}` +
      `) GROUP BY locus_id`,
  });

  // 8. INSERT scored_evidence — one row per (locus, evidence row).
  await ds.exec({
    sql:
      `INSERT INTO main.scored_evidence (` +
      `  locus_id, loci_source_id, loci_derivation_id, ` +
      `  gene_symbol, evidence_category, source_tag, trait, trait_id, ` +
      `  pvalue, effect_size, score, tissue, cell_type, rsid, ancestry, sex, ` +
      `  match_type, integration_rank, is_predicted_effector, n_candidate_genes` +
      `) ` +
      `SELECT ae.locus_id, ae.loci_source_id, ae.loci_derivation_id, ` +
      `       ae.gene_symbol, ae.evidence_category, ` +
      `       ae.source_tag, ae.trait, ae.trait_id, ae.pvalue, ae.effect_size, ae.score, ` +
      `       ae.tissue, ae.cell_type, ae.rsid, ae.ancestry, ae.sex, ae.match_type, ` +
      `       sc.integration_rank, sc.is_predicted_effector, cc.n_candidate_genes ` +
      `FROM ${STAGING.allEv} ae ` +
      `LEFT JOIN ${STAGING.scores} sc ` +
      `  ON sc.locus_id = ae.locus_id AND sc.gene_symbol = ae.gene_symbol ` +
      `LEFT JOIN ${STAGING.candidateCounts} cc ON cc.locus_id = ae.locus_id`,
  });

  // 9. Stub rows: candidate genes with NO evidence at their locus.
  await ds.exec({
    sql:
      `INSERT INTO main.scored_evidence (` +
      `  locus_id, loci_source_id, loci_derivation_id, gene_symbol, match_type, ` +
      `  integration_rank, is_predicted_effector, n_candidate_genes` +
      `) ` +
      `SELECT c.locus_id, l.loci_source_id, l.loci_derivation_id, c.gene_symbol, ` +
      `       'gene' AS match_type, NULL AS integration_rank, ` +
      `       FALSE AS is_predicted_effector, cc.n_candidate_genes ` +
      `FROM ${STAGING.candidates} c ` +
      `JOIN main.loci l ON l.locus_id = c.locus_id ` +
      `LEFT JOIN ${STAGING.candidateCounts} cc ON cc.locus_id = c.locus_id ` +
      `WHERE NOT EXISTS (` +
      `  SELECT 1 FROM ${STAGING.allEv} ae ` +
      `  WHERE ae.locus_id = c.locus_id AND ae.gene_symbol = c.gene_symbol` +
      `)`,
  });

  // 10. Update n_candidate_genes on loci.
  await ds.exec({
    sql:
      `UPDATE main.loci SET n_candidate_genes = COALESCE((` +
      `  SELECT COUNT(DISTINCT gene_symbol) FROM main.scored_evidence ` +
      `  WHERE scored_evidence.locus_id = loci.locus_id` +
      `), 0)`,
  });

  // 11. Cleanup staging tables.
  for (const t of Object.values(STAGING)) {
    await ds.exec({ sql: `DROP TABLE IF EXISTS ${t}` });
  }

  // 12. Counts for return value.
  const [scoredCount] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.scored_evidence",
  });
  const [lociCount] = await ds.query<{ n: number }>({
    sql:
      "SELECT COUNT(DISTINCT locus_id) AS n FROM main.scored_evidence",
  });

  return {
    scored_rows: Number(scoredCount?.n ?? 0),
    loci: Number(lociCount?.n ?? 0),
  };
}
