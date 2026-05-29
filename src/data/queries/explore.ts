// Read layer for the Explore browse lists (plan 2026-05-28-explore-ui-browse).
// Reads the derived relations (main.loci / main.locus_evidence / main.evidence)
// + config tables. NOTE: the sibling queries/*.ts files read the OLD, deleted
// schema (scored_evidence / gene_search_index / data_sources) — do not reuse
// them; these are fresh against the redesigned relations.

import { getDataSource } from "../select";
import type { LocusGene, LocusGeneEvidence } from "../../api/types";

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

// (Studies are not an Explore browse entity — a "study" is a proxy for a
// source-via-mapping, owned by the Sources tab. Loci carry their source_tag
// for provenance.)

// --- Trait detail ---

export interface TraitDetail {
  trait_id: string;
  label: string;
  description: string | null;
  primary_ontology: string | null;
  primary_ontology_id: string | null;
}

export async function getTrait(traitId: string): Promise<TraitDetail | null> {
  const ds = getDataSource();
  const [row] = await ds.query<TraitDetail>({
    sql:
      "SELECT id AS trait_id, label, description, primary_ontology, " +
      "       primary_ontology_id FROM config.traits WHERE id = ? LIMIT 1",
    params: [traitId],
  });
  return row ?? null;
}

/** Loci implicated for a trait (have ≥1 evidence row for it). Carries
 *  source_tag for multi-source coloring on the track. */
export async function traitLoci(traitId: string): Promise<LocusRow[]> {
  const ds = getDataSource();
  return ds.query<LocusRow>({
    sql:
      "SELECT DISTINCT l.locus_id, l.locus_name, l.chromosome, " +
      "       l.start_position, l.end_position, l.lead_rsid, l.lead_pvalue, " +
      "       l.n_signals, l.n_candidate_genes, l.source_tag " +
      "FROM main.loci l " +
      "JOIN main.locus_evidence le ON le.locus_id = l.locus_id " +
      "WHERE le.trait_id = ? " +
      "ORDER BY l.chromosome, l.start_position",
    params: [traitId],
  });
}

/** Distinct loci-mapping sources whose loci this trait touches — for the
 *  track/list color legend. */
export async function traitSourceTags(traitId: string): Promise<string[]> {
  const ds = getDataSource();
  const rows = await ds.query<{ source_tag: string }>({
    sql:
      "SELECT DISTINCT l.source_tag FROM main.loci l " +
      "JOIN main.locus_evidence le ON le.locus_id = l.locus_id " +
      "WHERE le.trait_id = ? AND l.source_tag IS NOT NULL ORDER BY l.source_tag",
    params: [traitId],
  });
  return rows.map((r) => r.source_tag);
}

export interface TraitSourceRow {
  source_tag: string;
  categories: string[];
  n_evidence: number;
  n_genes: number;
}

/** Evidence sources contributing to a trait — for the contributing-sources
 *  panel. Grouped by source_tag with its evidence categories. */
export async function traitSources(traitId: string): Promise<TraitSourceRow[]> {
  const ds = getDataSource();
  const rows = await ds.query<{
    source_tag: string;
    categories: string[] | string;
    n_evidence: number;
    n_genes: number;
  }>({
    sql:
      "SELECT source_tag, " +
      "       list(DISTINCT evidence_category) AS categories, " +
      "       COUNT(*) AS n_evidence, " +
      "       COUNT(DISTINCT gene_symbol) AS n_genes " +
      "FROM main.locus_evidence " +
      "WHERE trait_id = ? AND match_type <> 'candidate' AND source_tag IS NOT NULL " +
      "GROUP BY source_tag ORDER BY n_evidence DESC",
    params: [traitId],
  });
  return rows.map((r) => ({
    source_tag: r.source_tag,
    categories: Array.isArray(r.categories)
      ? (r.categories as string[]).filter(Boolean)
      : [],
    n_evidence: Number(r.n_evidence),
    n_genes: Number(r.n_genes),
  }));
}

/** Build LocusGene[] for the evidence heatmap at one locus, scoped to a
 *  trait. Genes whose only rows are candidate stubs (match_type='candidate',
 *  NULL evidence) come back with an empty evidence[] = neighborhood genes. */
export async function locusGenes(
  locusId: string,
  traitId: string,
): Promise<LocusGene[]> {
  const ds = getDataSource();
  // Candidate stubs aren't trait-scoped (a neighborhood gene belongs to the
  // locus, not a trait); real evidence is trait-scoped.
  const rows = await ds.query<{
    gene_symbol: string;
    match_type: string;
    evidence_category: string | null;
    evidence_stream: string | null;
    source_tag: string | null;
    pvalue: number | string | null;
    effect_size: number | string | null;
    score: number | string | null;
    tissue: string | null;
    cell_type: string | null;
    ancestry: string | null;
    sex: string | null;
  }>({
    sql:
      "SELECT gene_symbol, match_type, evidence_category, evidence_stream, " +
      "       source_tag, pvalue, effect_size, score, tissue, cell_type, " +
      "       ancestry, sex " +
      "FROM main.locus_evidence " +
      "WHERE locus_id = ? AND gene_symbol IS NOT NULL " +
      "  AND (match_type = 'candidate' OR trait_id = ?)",
    params: [locusId, traitId],
  });

  const byGene = new Map<string, LocusGene>();
  for (const r of rows) {
    let g = byGene.get(r.gene_symbol);
    if (!g) {
      g = { gene_symbol: r.gene_symbol, evidence: [] };
      byGene.set(r.gene_symbol, g);
    }
    if (r.match_type !== "candidate" && r.evidence_category) {
      const ev: LocusGeneEvidence = {
        evidence_category: r.evidence_category,
        source_tag: r.source_tag ?? "",
      };
      if (r.evidence_stream != null) ev.evidence_stream = r.evidence_stream;
      if (r.pvalue != null) ev.pvalue = r.pvalue;
      if (r.effect_size != null) ev.effect_size = r.effect_size;
      if (r.score != null) ev.score = r.score;
      if (r.tissue != null) ev.tissue = r.tissue;
      if (r.cell_type != null) ev.cell_type = r.cell_type;
      if (r.ancestry != null) ev.ancestry = r.ancestry;
      if (r.sex != null) ev.sex = r.sex;
      g.evidence.push(ev);
    }
  }
  return [...byGene.values()].sort((a, b) =>
    a.gene_symbol.localeCompare(b.gene_symbol),
  );
}
