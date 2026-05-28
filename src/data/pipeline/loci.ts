// Build the materialized `main.loci` table — the one real computation in the
// data layer (window + interval-merge), and the stable locus_id join hub for
// locus_evidence. Port of the deleted dd2f1fb~1:src/data/pipeline/loci.ts,
// adapted to the redesigned schema (plan 2026-05-28):
//   - per loci-target MAPPING (not derivation)
//   - reads variants from the `main.evidence` VIEW (filtered to the mapping's
//     source_tag), so buildEvidenceView() must run first
//   - window/merge are per-mapping (config.mappings.window_kb /
//     merge_distance_kb), falling back to pegasus_settings defaults
//   - lead variant = lowest p-value; NULL when the source has no pvalue
//   - per-source separation: loci are NOT merged across sources (each
//     loci-mapping owns its loci by source_tag; rebuilt per source_tag)

import { getDataSource } from "../select";
import { listSources } from "../sourceOps";
import { listMappingsForSource } from "../mappingOps";

const MAIN_LOCI_DDL = `CREATE TABLE IF NOT EXISTS main.loci (
  locus_id          VARCHAR PRIMARY KEY,
  source_tag        VARCHAR,
  locus_name        VARCHAR,
  chromosome        VARCHAR,
  start_position    BIGINT,
  end_position      BIGINT,
  lead_rsid         VARCHAR,
  lead_position     BIGINT,
  lead_pvalue       DOUBLE,
  n_signals         INTEGER,
  n_candidate_genes INTEGER
)`;

export interface BuildLociResult {
  source_tag: string;
  loci: number;
}

async function defaults(): Promise<{ window_kb: number; merge_kb: number }> {
  const ds = getDataSource();
  const [s] = await ds.query<{ window_kb: number; merge_distance_kb: number }>({
    sql: "SELECT window_kb, merge_distance_kb FROM config.pegasus_settings WHERE id = 1",
  });
  return {
    window_kb: Number(s?.window_kb ?? 500),
    merge_kb: Number(s?.merge_distance_kb ?? 100),
  };
}

/** Rebuild loci for one loci-target mapping. Clears prior rows for its
 *  source_tag, then inserts fresh merged loci. window/merge come from the
 *  mapping, falling back to the supplied settings defaults. */
async function buildOne(
  sourceName: string,
  sourceTag: string,
  windowKb: number,
  mergeKb: number,
): Promise<BuildLociResult> {
  const ds = getDataSource();
  const windowBp = windowKb * 1000;
  const mergeBp = mergeKb * 1000;

  await ds.exec({
    sql: "DELETE FROM main.loci WHERE source_tag = ?",
    params: [sourceTag],
  });

  // Window + gap-and-island merge in one CTE chain. ARG_MIN picks the
  // rsid/position of the lowest-pvalue variant per merged group as the lead;
  // when every pvalue is NULL, ARG_MIN returns NULL → lead stays NULL.
  const sql = `
    WITH variants AS (
      SELECT chromosome,
             CAST(position AS BIGINT) AS position,
             CAST(rsid AS VARCHAR) AS rsid,
             CAST(pvalue AS DOUBLE) AS pvalue
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
      (locus_id, source_tag, locus_name, chromosome, start_position,
       end_position, lead_rsid, lead_position, lead_pvalue, n_signals,
       n_candidate_genes)
    SELECT
      ? || '_' || chromosome || '_' || grp AS locus_id,
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
    params: [sourceTag, sourceName, sourceTag],
  });

  const [c] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.loci WHERE source_tag = ?",
    params: [sourceTag],
  });
  return { source_tag: sourceTag, loci: Number(c?.n ?? 0) };
}

/** Rebuild main.loci for every loci-target mapping. Reads from main.evidence,
 *  so buildEvidenceView() must have run. Returns per-source counts. */
export async function buildLoci(): Promise<BuildLociResult[]> {
  const ds = getDataSource();
  await ds.exec({ sql: MAIN_LOCI_DDL });
  const { window_kb, merge_kb } = await defaults();

  const sources = await listSources();
  const results: BuildLociResult[] = [];
  for (const src of sources) {
    const mappings = await listMappingsForSource(src.id);
    for (const m of mappings.filter((x) => x.target === "loci")) {
      results.push(
        await buildOne(
          src.name,
          m.source_tag,
          m.window_kb ?? window_kb,
          m.merge_distance_kb ?? merge_kb,
        ),
      );
    }
  }
  return results;
}
