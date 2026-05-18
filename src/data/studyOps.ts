// Phase 6 — Studies view.
//
// There is no separate `studies` table in the redesigned model: a
// "study" is just a source that defines loci, i.e. has at least one
// derivation with role = 'loci_definition'. listStudies is a read-only
// projection over config.sources ⋈ config.derivations (+ citation +
// locus counts) — no schema, no writes.

import { getDataSource, tableExists } from "./select";

export interface Study {
  id: string;
  name: string;
  display_name: string | null;
  source_type: string;
  /** How many loci_definition derivations this source has. */
  loci_derivations: number;
  /** Rows in main.loci attributed to this source. null when no build
   *  has run yet (main.loci absent) — distinct from 0. */
  locus_count: number | null;
  gwas_source: string | null;
  ancestry: string | null;
  sample_size: number | null;
  doi: string | null;
  year: number | null;
  pubmed_id: string | null;
}

interface StudyRow {
  id: string;
  name: string;
  display_name: string | null;
  source_type: string;
  loci_derivations: number;
  gwas_source: string | null;
  ancestry: string | null;
  sample_size: number | null;
  doi: string | null;
  year: number | null;
  pubmed_id: string | null;
}

export async function listStudies(): Promise<Study[]> {
  const ds = getDataSource();
  const rows = await ds.query<StudyRow>({
    sql:
      "SELECT s.id, s.name, s.display_name, s.source_type, " +
      "       COUNT(DISTINCT d.id) AS loci_derivations, " +
      "       c.gwas_source, c.ancestry, c.sample_size, " +
      "       c.doi, c.year, c.pubmed_id " +
      "FROM config.sources s " +
      "JOIN config.derivations d " +
      "  ON d.source_id = s.id AND d.role = 'loci_definition' " +
      "LEFT JOIN config.source_citation c ON c.source_id = s.id " +
      "GROUP BY s.id, s.name, s.display_name, s.source_type, " +
      "         c.gwas_source, c.ancestry, c.sample_size, " +
      "         c.doi, c.year, c.pubmed_id " +
      "ORDER BY s.name",
  });

  const hasLoci = await tableExists("loci");

  return Promise.all(
    rows.map(async (r) => {
      let locus_count: number | null = null;
      if (hasLoci) {
        const [c] = await ds.query<{ n: number }>({
          sql: "SELECT COUNT(*) AS n FROM main.loci WHERE loci_source_id = ?",
          params: [r.id],
        });
        locus_count = Number(c?.n ?? 0);
      }
      return {
        id: r.id,
        name: r.name,
        display_name: r.display_name,
        source_type: r.source_type,
        loci_derivations: Number(r.loci_derivations),
        locus_count,
        gwas_source: r.gwas_source,
        ancestry: r.ancestry,
        sample_size: r.sample_size == null ? null : Number(r.sample_size),
        doi: r.doi,
        year: r.year == null ? null : Number(r.year),
        pubmed_id: r.pubmed_id,
      };
    }),
  );
}
