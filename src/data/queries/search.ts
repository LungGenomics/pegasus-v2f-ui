// Unified Explore search: type a string → one ranked list of matching genes,
// loci, and traits (each row tagged with its type). No auto-navigation — the
// user always picks from the list. Queries the live views directly (no index).

import { getDataSource } from "../select";

function strLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export type HitType = "gene" | "locus" | "trait";

export interface JointHit {
  type: HitType;
  key: string; // gene_symbol / locus_id / trait_id
  label: string;
  n: number; // gene/trait → # loci; locus → # candidate genes
  score: number;
}

/** One ranked list across genes, loci, and traits — tolerant of non-exact
 *  queries (partials/substrings) with exact > prefix > substring scoring,
 *  plus trait synonym + ontology matching. The UI tags each row with its
 *  type. (Uses only core string ops — no similarity extension.) */
export async function jointSearch(raw: string, limit = 25): Promise<JointHit[]> {
  const q = raw.trim();
  if (!q) return [];
  const ds = getDataSource();
  const lower = strLit(q.toLowerCase());
  const like = strLit(`%${q}%`);

  // Relevance score for a column: exact > prefix > substring.
  const score = (col: string) =>
    `CASE WHEN lower(${col}) = ${lower} THEN 1.0
          WHEN starts_with(lower(${col}), ${lower}) THEN 0.9
          WHEN ${col} ILIKE ${like} THEN 0.8 ELSE 0 END`;
  const match = (col: string) => `${col} ILIKE ${like}`;

  const sql = `
    WITH hits AS (
      -- Genes: only those implicated in THIS database — i.e. present in
      -- locus_evidence (a candidate of some locus or carrying evidence). The
      -- full gene_reference is the whole genome; searching it surfaced genes
      -- with no loci hits (n=0), which is noise. n = # loci implicating it.
      SELECT 'gene' AS type, CAST(le.gene_symbol AS VARCHAR) AS key,
             le.gene_symbol AS label,
             CAST(COUNT(DISTINCT le.locus_id) AS INTEGER) AS n,
             ${score("le.gene_symbol")} AS score
      FROM main.locus_evidence le
      WHERE le.gene_symbol IS NOT NULL AND ${match("le.gene_symbol")}
      GROUP BY le.gene_symbol

      UNION ALL
      SELECT 'locus', CAST(locus_id AS VARCHAR), COALESCE(locus_name, locus_id),
             CAST(COALESCE(n_candidate_genes, 0) AS INTEGER),
             GREATEST(${score("locus_name")},
                      CASE WHEN lower(lead_rsid) = ${lower} THEN 1.0 ELSE 0 END)
      FROM main.loci
      WHERE ${match("locus_name")} OR lower(lead_rsid) = ${lower}

      UNION ALL
      SELECT 'trait', CAST(t.id AS VARCHAR), t.label,
             CAST(COUNT(DISTINCT le.locus_id) AS INTEGER),
             GREATEST(${score("t.label")},
                      CASE WHEN t.ontology_label ILIKE ${like}
                                OR CAST(t.synonyms AS VARCHAR) ILIKE ${like}
                           THEN 0.8 ELSE 0 END)
      FROM config.traits t
      LEFT JOIN main.locus_evidence le ON le.trait_id = t.id
      WHERE ${match("t.label")} OR t.ontology_label ILIKE ${like}
            OR CAST(t.synonyms AS VARCHAR) ILIKE ${like}
      GROUP BY t.id, t.label, t.ontology_label, t.synonyms
    )
    SELECT type, key, label, n, score FROM hits
    ORDER BY score DESC, n DESC LIMIT ${limit}`;

  return ds.query<JointHit>({ sql });
}
