// Read layer for the Explore browse lists (plan 2026-05-28-explore-ui-browse).
// Reads the derived relations (main.loci / main.locus_evidence / main.evidence)
// + config tables. NOTE: the sibling queries/*.ts files read the OLD, deleted
// schema (scored_evidence / gene_search_index / data_sources) — do not reuse
// them; these are fresh against the redesigned relations.

import { getDataSource } from "../select";

export interface LocusRow {
  locus_id: string;
  locus_name: string | null;
  chromosome: string | null;
  start_position: number | null;
  end_position: number | null;
  lead_rsid: string | null;
  lead_pvalue: number | null;
  n_signals: number | null;
  n_candidate_genes: number | null;
  source_tag: string | null;
}

export async function listLoci(): Promise<LocusRow[]> {
  const ds = getDataSource();
  return ds.query<LocusRow>({
    sql:
      "SELECT locus_id, locus_name, chromosome, start_position, end_position, " +
      "       lead_rsid, lead_pvalue, n_signals, n_candidate_genes, source_tag " +
      "FROM main.loci ORDER BY chromosome, start_position",
  });
}

export interface GeneRow {
  gene_symbol: string;
  chromosome: string | null;
  start: number | null;
  gene_type: string | null;
  n_loci: number;
  n_evidence: number;
  n_categories: number;
}

/** Implicated genes only — genes that appear in locus_evidence (candidate or
 *  with evidence), NOT the full gene reference. LEFT JOIN the reference for
 *  coordinates / biotype. */
export async function listImplicatedGenes(): Promise<GeneRow[]> {
  const ds = getDataSource();
  return ds.query<GeneRow>({
    sql:
      "SELECT le.gene_symbol, " +
      "       ANY_VALUE(g.chromosome) AS chromosome, " +
      "       ANY_VALUE(g.start) AS start, " +
      "       ANY_VALUE(g.gene_type) AS gene_type, " +
      "       COUNT(DISTINCT le.locus_id) AS n_loci, " +
      "       COUNT(*) FILTER (WHERE le.match_type <> 'candidate') AS n_evidence, " +
      "       COUNT(DISTINCT le.evidence_category) " +
      "         FILTER (WHERE le.match_type <> 'candidate') AS n_categories " +
      "FROM main.locus_evidence le " +
      "LEFT JOIN main.gene_reference g ON g.gene_symbol = le.gene_symbol " +
      "WHERE le.gene_symbol IS NOT NULL " +
      "GROUP BY le.gene_symbol ORDER BY n_loci DESC, le.gene_symbol",
  });
}

export interface TraitRow {
  trait_id: string;
  label: string;
  n_loci: number;
  n_genes: number;
  n_evidence: number;
}

export async function listTraits(): Promise<TraitRow[]> {
  const ds = getDataSource();
  return ds.query<TraitRow>({
    sql:
      "SELECT t.id AS trait_id, t.label, " +
      "       COUNT(DISTINCT le.locus_id) AS n_loci, " +
      "       COUNT(DISTINCT le.gene_symbol) AS n_genes, " +
      "       COUNT(le.locus_id) FILTER (WHERE le.match_type <> 'candidate') AS n_evidence " +
      "FROM config.traits t " +
      "LEFT JOIN main.locus_evidence le ON le.trait_id = t.id " +
      "GROUP BY t.id, t.label ORDER BY n_loci DESC, t.label",
  });
}

export interface StudyRow {
  source_id: string;
  name: string;
  display_name: string | null;
  source_tag: string;
  window_kb: number | null;
  merge_distance_kb: number | null;
  n_loci: number;
}

/** A "study" = a source that has a loci-target mapping (loci-centric
 *  definition). Loci counts come from main.loci by the mapping's source_tag. */
export async function listStudies(): Promise<StudyRow[]> {
  const ds = getDataSource();
  return ds.query<StudyRow>({
    sql:
      "SELECT s.id AS source_id, s.name, s.display_name, m.source_tag, " +
      "       m.window_kb, m.merge_distance_kb, " +
      "       (SELECT COUNT(*) FROM main.loci l WHERE l.source_tag = m.source_tag) AS n_loci " +
      "FROM config.sources s " +
      "JOIN config.mappings m ON m.source_id = s.id AND m.target = 'loci' " +
      "ORDER BY s.name",
  });
}
