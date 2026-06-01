// Build the materialized `main.loci` table — the one real computation in the
// data layer (window + interval-merge), and the stable locus_id join hub for
// locus_evidence. Port of the deleted dd2f1fb~1:src/data/pipeline/loci.ts,
// adapted to the redesigned schema (plan 2026-05-28):
//   - per loci-target MAPPING (not derivation)
//   - reads variants from the loci mapping's OWN canonical projection
//     (mappingProjections) — NOT main.evidence, which contains only
//     evidence-target mappings. A loci mapping projects chromosome/position/
//     rsid/pvalue from its (transform-cleaned) source for window+merge.
//   - window/merge are per-mapping (config.mappings.window_kb /
//     merge_distance_kb), falling back to pegasus_settings defaults
//   - lead variant = lowest p-value; NULL when the source has no pvalue
//   - per-source separation: loci are NOT merged across sources (each
//     loci-mapping owns its loci by source_tag; rebuilt per source_tag)

import { getDataSource } from "../select";
import { listSources } from "../sourceOps";
import { listMappingsForSource } from "../mappingOps";
import { buildTransformedPipeline } from "../rawData";
import { mappingProjections } from "./evidence";
import { cytobandLabel } from "../cytobands";
import type { ConfigMapping } from "../../api/types";

const MAIN_LOCI_DDL = `CREATE TABLE IF NOT EXISTS main.loci (
  locus_id          VARCHAR PRIMARY KEY,
  source_tag        VARCHAR,
  trait_id          UUID,
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
  variantsSql: string,
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

  // Window + gap-and-island merge in one CTE chain over the loci mapping's
  // own projection (chromosome/position/rsid/pvalue/trait_id). Loci are
  // trait-scoped: windowing/merging PARTITION BY trait_id so signals from
  // different traits (a multi-trait source) never merge into a shared locus.
  // ARG_MIN picks the rsid/position of the lowest-pvalue variant per merged
  // group as the lead; when every pvalue is NULL, ARG_MIN returns NULL → lead
  // stays NULL. Variants with no trait_id are dropped (trait is required for
  // loci mappings).
  const sql = `
    WITH variants AS (
      -- TRY_CAST so dirty sentinels (e.g. position 'NA') become NULL and drop
      -- out below rather than aborting the whole build.
      SELECT chromosome,
             TRY_CAST(position AS BIGINT) AS position,
             CAST(rsid AS VARCHAR) AS rsid,
             TRY_CAST(pvalue AS DOUBLE) AS pvalue,
             trait_id
      FROM (${variantsSql}) _proj
      WHERE chromosome IS NOT NULL
        -- Drop dirty chromosome sentinels ('NA', 'N/A', '.', '') — they'd
        -- otherwise materialize an unplottable "chrNA" locus.
        AND UPPER(TRIM(CAST(chromosome AS VARCHAR))) NOT IN ('NA', 'N/A', 'NULL', '.', '')
        AND TRY_CAST(position AS BIGINT) IS NOT NULL
        AND trait_id IS NOT NULL
    ),
    windows AS (
      SELECT chromosome, position, rsid, pvalue, trait_id,
             GREATEST(0, position - ${windowBp}) AS w_start,
             position + ${windowBp} AS w_end
      FROM variants
    ),
    gap_flag AS (
      SELECT chromosome, position, rsid, pvalue, trait_id, w_start, w_end,
             CASE
               WHEN LAG(chromosome) OVER (PARTITION BY trait_id ORDER BY chromosome, w_start) = chromosome
                 AND w_start <= LAG(w_end) OVER (PARTITION BY trait_id ORDER BY chromosome, w_start) + ${mergeBp}
               THEN 0 ELSE 1
             END AS is_new_locus
      FROM windows
    ),
    grouped AS (
      SELECT chromosome, position, rsid, pvalue, trait_id, w_start, w_end,
             SUM(is_new_locus) OVER (PARTITION BY trait_id ORDER BY chromosome, w_start) AS grp
      FROM gap_flag
    )
    INSERT INTO main.loci
      (locus_id, source_tag, trait_id, locus_name, chromosome, start_position,
       end_position, lead_rsid, lead_position, lead_pvalue, n_signals,
       n_candidate_genes)
    SELECT
      ? || '_' || SUBSTR(CAST(trait_id AS VARCHAR), 1, 8) || '_' || chromosome || '_' || grp AS locus_id,
      ? AS source_tag,
      trait_id,
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
    GROUP BY trait_id, chromosome, grp
  `;
  await ds.exec({
    sql,
    params: [sourceName, sourceTag],
  });

  const [c] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.loci WHERE source_tag = ?",
    params: [sourceTag],
  });
  return { source_tag: sourceTag, loci: Number(c?.n ?? 0) };
}

/** Rebuild main.loci for every loci-target mapping, from each mapping's own
 *  projected variants (independent of main.evidence). Returns per-source
 *  counts. A loci mapping that can't project (e.g. no fields) yields 0 loci. */
export async function buildLoci(): Promise<BuildLociResult[]> {
  const ds = getDataSource();
  await ds.exec({ sql: MAIN_LOCI_DDL });
  const { window_kb, merge_kb } = await defaults();

  const sources = await listSources();
  const results: BuildLociResult[] = [];
  for (const src of sources) {
    const mappings = await listMappingsForSource(src.id);
    const lociMappings = mappings.filter((x) => x.target === "loci");
    if (lociMappings.length === 0) continue;
    const pipeline = await buildTransformedPipeline(src.id);
    for (const m of lociMappings) {
      const variantsSql = lociVariantsSql(m, pipeline);
      if (!variantsSql) {
        results.push({ source_tag: m.source_tag, loci: 0 });
        continue;
      }
      results.push(
        await buildOne(
          src.name,
          m.source_tag,
          variantsSql,
          m.window_kb ?? window_kb,
          m.merge_distance_kb ?? merge_kb,
        ),
      );
    }
  }

  await nameLociByCytoband();
  return results;
}

/** Name loci by their cytogenetic band (locus_name), restoring the old
 *  pipeline's behavior. The coordinate string stays derivable from the
 *  geometry columns (chromosome/start/end), so the UI can toggle between the
 *  two. Computed in JS from the bundled hg38 cytoband table. */
async function nameLociByCytoband(): Promise<void> {
  const ds = getDataSource();
  const rows = await ds.query<{
    locus_id: string;
    chromosome: string | null;
    start_position: number | null;
    end_position: number | null;
  }>({
    sql: "SELECT locus_id, chromosome, start_position, end_position FROM main.loci",
  });
  for (const r of rows) {
    if (!r.chromosome || r.start_position == null || r.end_position == null) continue;
    const name = cytobandLabel(
      r.chromosome,
      Number(r.start_position),
      Number(r.end_position),
    );
    await ds.exec({
      sql: "UPDATE main.loci SET locus_name = ? WHERE locus_id = ?",
      params: [name, r.locus_id],
    });
  }
}

/** The loci mapping's canonical projection (its variants), or null if it
 *  can't project. Each projection carries a trait_id (constant → one SELECT per
 *  trait with a literal id; column → one SELECT resolving trait_id per row), and
 *  buildOne windows/merges PARTITION BY trait_id — so a multi-trait source
 *  yields independent per-trait loci. */
function lociVariantsSql(
  mapping: ConfigMapping,
  pipeline: string,
): string | null {
  const projections = mappingProjections(mapping, pipeline);
  if (projections.length === 0) return null;
  return projections.join(" UNION ALL ");
}
