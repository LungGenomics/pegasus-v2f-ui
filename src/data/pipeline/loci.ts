// Loci derivation. For each source role=loci_definition derivation,
// read the variant rows it wrote into main.evidence, apply the
// window+merge logic from pegasus_settings, and write into main.loci.
//
// Pipeline:
//   1. Take main.evidence rows with source_tag = derivation.source_tag
//      and chromosome + position not null.
//   2. Expand each variant to [position - window_bp, position + window_bp].
//   3. Merge overlapping or near-overlapping windows (within
//      merge_distance_bp) using the gap-and-island trick (LAG + cumsum).
//   4. For each merged interval, pick the lead variant (lowest pvalue)
//      and emit one row in main.loci.

import { getDataSource } from "../select";
import type { ConfigDerivation, ConfigSource } from "../../api/types";

const MAIN_LOCI_DDL = `CREATE TABLE IF NOT EXISTS main.loci (
  locus_id           VARCHAR PRIMARY KEY,
  loci_source_id     UUID,
  loci_derivation_id UUID,
  source_tag         VARCHAR,
  locus_name         VARCHAR,
  chromosome         VARCHAR,
  start_position     BIGINT,
  end_position       BIGINT,
  lead_variant_id    VARCHAR,
  lead_rsid          VARCHAR,
  lead_pvalue        DOUBLE,
  lead_position      BIGINT,
  n_signals          INTEGER,
  n_candidate_genes  INTEGER
)`;

// A CLI-built gene.duckdb already has main.loci with the legacy shape
// (study_id, no loci_source_id / loci_derivation_id / source_tag /
// lead_position). CREATE TABLE IF NOT EXISTS no-ops on it, so ALTER
// ADD COLUMN IF NOT EXISTS each column too — idempotent, keeps rows.
const LOCI_COLUMNS: Array<[string, string]> = [
  ["loci_source_id", "UUID"],
  ["loci_derivation_id", "UUID"],
  ["source_tag", "VARCHAR"],
  ["locus_name", "VARCHAR"],
  ["chromosome", "VARCHAR"],
  ["start_position", "BIGINT"],
  ["end_position", "BIGINT"],
  ["lead_variant_id", "VARCHAR"],
  ["lead_rsid", "VARCHAR"],
  ["lead_pvalue", "DOUBLE"],
  ["lead_position", "BIGINT"],
  ["n_signals", "INTEGER"],
  ["n_candidate_genes", "INTEGER"],
];

async function ensureLociSchema(
  ds: ReturnType<typeof getDataSource>,
): Promise<void> {
  await ds.exec({ sql: MAIN_LOCI_DDL });
  for (const [col, type] of LOCI_COLUMNS) {
    await ds.exec({
      sql: `ALTER TABLE main.loci ADD COLUMN IF NOT EXISTS ${col} ${type}`,
    });
  }
  // A CLI-built table has a legacy column
  // `study_id VARCHAR NOT NULL REFERENCES studies(study_id)` that the
  // redesigned insert doesn't populate. We can't DROP the column (the
  // FK depends on it) and DuckDB can't easily drop an auto-named FK
  // constraint, so instead just relax NOT NULL: a NULL in a child FK
  // column is not enforced, so the insert passes with study_id = NULL
  // without touching the constraint or legacy rows. Best-effort —
  // there's no DROP NOT NULL IF EXISTS, and the column is absent on a
  // fresh web-created DB.
  try {
    await ds.exec({
      sql: "ALTER TABLE main.loci ALTER COLUMN study_id DROP NOT NULL",
    });
  } catch {
    /* column absent (fresh DB) or already nullable — fine */
  }
}

export interface DeriveLociResult {
  derivation_id: string;
  source_tag: string;
  loci: number;
}

/** Re-derive loci for one loci_definition derivation. Clears any prior
 *  main.loci rows tied to this derivation's source_tag, then inserts
 *  fresh ones. */
export async function deriveLoci(
  source: ConfigSource,
  derivation: ConfigDerivation,
): Promise<DeriveLociResult> {
  if (derivation.role !== "loci_definition") {
    return {
      derivation_id: derivation.id,
      source_tag: derivation.source_tag,
      loci: 0,
    };
  }
  const ds = getDataSource();
  await ensureLociSchema(ds);

  // Pull window + merge distances from settings.
  const [settings] = await ds.query<{
    window_kb: number;
    merge_distance_kb: number;
  }>({
    sql:
      "SELECT window_kb, merge_distance_kb FROM config.pegasus_settings WHERE id = 1",
  });
  const windowBp = (Number(settings?.window_kb ?? 500)) * 1000;
  const mergeBp = (Number(settings?.merge_distance_kb ?? 100)) * 1000;

  // Clear any prior loci tied to this derivation.
  await ds.exec({
    sql: "DELETE FROM main.loci WHERE source_tag = ?",
    params: [derivation.source_tag],
  });

  // Window + merge in one CTE chain. ARG_MIN picks the rsid/position of
  // the lowest-pvalue variant within each merged group, which we treat
  // as the locus's lead variant.
  const sql = `
    WITH variants AS (
      SELECT chromosome,
             CAST(position AS BIGINT) AS position,
             CAST(rsid AS VARCHAR) AS rsid,
             pvalue
      FROM main.evidence
      WHERE source_tag = ?
        AND chromosome IS NOT NULL
        AND position IS NOT NULL
    ),
    windows AS (
      SELECT chromosome, position, rsid, pvalue,
             GREATEST(0, position - ${windowBp}) AS w_start,
             position + ${windowBp} AS w_end
      FROM variants
    ),
    gap_flag AS (
      SELECT chromosome, position, rsid, pvalue, w_start, w_end,
             CASE
               WHEN LAG(chromosome) OVER (ORDER BY chromosome, w_start) = chromosome
                 AND w_start <= LAG(w_end) OVER (ORDER BY chromosome, w_start) + ${mergeBp}
               THEN 0 ELSE 1
             END AS is_new_locus
      FROM windows
    ),
    grouped AS (
      SELECT chromosome, position, rsid, pvalue, w_start, w_end,
             SUM(is_new_locus) OVER (ORDER BY chromosome, w_start) AS grp
      FROM gap_flag
    )
    INSERT INTO main.loci
      (locus_id, loci_source_id, loci_derivation_id, source_tag,
       locus_name, chromosome, start_position, end_position,
       lead_rsid, lead_position, lead_pvalue, n_signals, n_candidate_genes)
    SELECT
      ? || '_' || chromosome || '_' || grp AS locus_id,
      CAST(? AS UUID) AS loci_source_id,
      CAST(? AS UUID) AS loci_derivation_id,
      ? AS source_tag,
      chromosome || ':' ||
        CAST(MIN(w_start) AS VARCHAR) || '-' || CAST(MAX(w_end) AS VARCHAR) AS locus_name,
      chromosome,
      MIN(w_start) AS start_position,
      MAX(w_end) AS end_position,
      ARG_MIN(rsid, pvalue) AS lead_rsid,
      ARG_MIN(position, pvalue) AS lead_position,
      MIN(pvalue) AS lead_pvalue,
      COUNT(*) AS n_signals,
      0 AS n_candidate_genes
    FROM grouped
    GROUP BY chromosome, grp
  `;
  await ds.exec({
    sql,
    params: [
      derivation.source_tag,
      // locus_id prefix uses the source name for human-readable IDs
      source.name,
      source.id,
      derivation.id,
      derivation.source_tag,
    ],
  });

  const [count] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.loci WHERE source_tag = ?",
    params: [derivation.source_tag],
  });

  return {
    derivation_id: derivation.id,
    source_tag: derivation.source_tag,
    loci: Number(count?.n ?? 0),
  };
}
