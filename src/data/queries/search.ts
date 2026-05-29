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
      -- Genes: search the full reference so any gene is findable; the count
      -- is how many loci implicate it (0 = present but not implicated here).
      SELECT 'gene' AS type, CAST(g.gene_symbol AS VARCHAR) AS key,
             g.gene_symbol AS label,
             CAST(COUNT(DISTINCT le.locus_id) AS INTEGER) AS n,
             ${score("g.gene_symbol")} AS score
      FROM main.gene_reference g
      LEFT JOIN main.locus_evidence le ON le.gene_symbol = g.gene_symbol
      WHERE ${match("g.gene_symbol")}
      GROUP BY g.gene_symbol

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
