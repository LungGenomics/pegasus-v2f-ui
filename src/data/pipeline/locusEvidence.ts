// Build the `main.locus_evidence` view + update main.loci.n_candidate_genes.
// Port of the join half of dd2f1fb~1:src/data/pipeline/materialize.ts, with
// the scoring layer removed (no score/integration_rank/is_predicted_effector)
// per the 2026-05-19 brainstorm. Plan: 2026-05-28-explore-data-layer.md.
//
// locus_evidence is a VIEW over main.evidence, main.loci, and the local
// main.gene_reference table (loaded by ensureGeneReference). It tags each
// row with match_type:
//   'position'  — variant evidence whose chr+pos falls in the locus window
//   'gene'      — gene-keyed evidence (chromosome IS NULL) for a candidate or
//                 variant-matched gene of the locus
//   'candidate' — a neighborhood gene from the reference with NO evidence
//                 (stub, all evidence columns NULL — "keep neighborhood
//                 genes, evidence or not")
//
// n_candidate_genes (the count of reference genes overlapping the locus
// window, biotype-filtered) is a LOCUS property → written back onto main.loci,
// not carried on every evidence row.

import { getDataSource } from "../select";

// The 15 canonical evidence columns, in order. locus_evidence = these +
// locus_id + match_type.
const EVIDENCE_COLS = [
  "gene_symbol",
  "chromosome",
  "position",
  "rsid",
  "pvalue",
  "effect_size",
  "score",
  "tissue",
  "cell_type",
  "ancestry",
  "sex",
  "evidence_stream",
  "evidence_category",
  "source_tag",
  "trait_id",
] as const;

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function strLit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** SQL predicate restricting candidate genes to the configured biotypes.
 *  Empty / unset setting = no filter (all biotypes). */
async function biotypeFilter(): Promise<string> {
  const ds = getDataSource();
  const [row] = await ds.query<{ candidate_gene_biotypes: string | null }>({
    sql: "SELECT candidate_gene_biotypes FROM config.pegasus_settings WHERE id = 1",
  });
  const raw = (row?.candidate_gene_biotypes ?? "").trim();
  if (!raw) return "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(strLit)
    .join(", ");
  return list ? ` AND g.gene_type IN (${list})` : "";
}

/** Candidate genes per locus: reference genes whose coords overlap the locus
 *  window, biotype-filtered. Shared by the view and the n_candidate_genes
 *  update. Assumes main.gene_reference is loaded (ensureGeneReference). */
function candidatesCte(filter: string): string {
  return (
    `SELECT DISTINCT l.locus_id, g.gene_symbol ` +
    `FROM main.loci l ` +
    `JOIN main.gene_reference g ` +
    `  ON g.chromosome = l.chromosome ` +
    `  AND g.${ident("start")} <= l.end_position ` +
    `  AND g.${ident("end")} >= l.start_position ` +
    `WHERE g.gene_symbol IS NOT NULL${filter}`
  );
}

/** Rebuild main.locus_evidence and refresh main.loci.n_candidate_genes.
 *  Requires main.evidence (buildEvidenceView), main.loci (buildLoci), and
 *  main.gene_reference (ensureGeneReference) to exist. */
export async function buildLocusEvidenceView(): Promise<void> {
  const ds = getDataSource();
  const filter = await biotypeFilter();
  const cand = candidatesCte(filter);

  // 1. Refresh n_candidate_genes on the loci table (locus property).
  await ds.exec({
    sql:
      `UPDATE main.loci SET n_candidate_genes = COALESCE(c.n, 0) FROM (` +
      `  SELECT locus_id, COUNT(*) AS n FROM (${cand}) GROUP BY locus_id` +
      `) c WHERE c.locus_id = main.loci.locus_id`,
  });
  // Loci with zero overlapping genes won't appear in the subquery → set 0.
  await ds.exec({
    sql:
      `UPDATE main.loci SET n_candidate_genes = 0 ` +
      `WHERE n_candidate_genes IS NULL`,
  });

  // 2. The view. Explicit column lists keep the three UNION branches aligned.
  const evCols = EVIDENCE_COLS.map((c) => `e.${ident(c)}`).join(", ");
  const evColsBare = EVIDENCE_COLS.map(ident).join(", ");

  // Stub branch: candidate gene with no evidence — gene_symbol from the
  // reference, every other evidence column NULL.
  const stubCols = EVIDENCE_COLS.map((c) =>
    c === "gene_symbol" ? `c.gene_symbol` : `NULL AS ${ident(c)}`,
  ).join(", ");

  const sql =
    `CREATE OR REPLACE VIEW main.locus_evidence AS ` +
    `WITH cand AS (${cand}), ` +
    `var_ev AS (` +
    `  SELECT l.locus_id, ${evCols}, 'position' AS match_type ` +
    `  FROM main.loci l ` +
    `  JOIN main.evidence e ` +
    `    ON e.chromosome = l.chromosome ` +
    `    AND e.position >= l.start_position ` +
    `    AND e.position <= l.end_position ` +
    `  WHERE e.chromosome IS NOT NULL AND e.position IS NOT NULL` +
    `), ` +
    `locus_genes AS (` +
    `  SELECT locus_id, gene_symbol FROM cand ` +
    `  UNION ` +
    `  SELECT DISTINCT locus_id, gene_symbol FROM var_ev` +
    `), ` +
    `gene_ev AS (` +
    `  SELECT lg.locus_id, ${evCols}, 'gene' AS match_type ` +
    `  FROM locus_genes lg ` +
    `  JOIN main.evidence e ON e.gene_symbol = lg.gene_symbol AND e.chromosome IS NULL` +
    `), ` +
    `ev AS (` +
    `  SELECT * FROM var_ev UNION ALL SELECT * FROM gene_ev` +
    `), ` +
    `stubs AS (` +
    `  SELECT c.locus_id, ${stubCols}, 'candidate' AS match_type ` +
    `  FROM cand c ` +
    `  LEFT JOIN ev ON ev.locus_id = c.locus_id AND ev.gene_symbol = c.gene_symbol ` +
    `  WHERE ev.locus_id IS NULL` +
    `) ` +
    `SELECT locus_id, ${evColsBare}, match_type FROM ev ` +
    `UNION ALL ` +
    `SELECT locus_id, ${evColsBare}, match_type FROM stubs`;

  await ds.exec({ sql });
}
