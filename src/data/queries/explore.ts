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
  /** Same-trait non-candidate evidence rows at this locus. Only populated by
   *  traitLoci() (for the evidence-count sort). */
  n_evidence?: number | null;
  source_tag: string | null;
  /** Gene nearest the locus's lead/source variant (window-midpoint fallback
   *  when the lead is NULL). Positional, trait-agnostic. Only populated by
   *  traitLoci(); NULL for loci with no candidate genes (gene desert). */
  nearest_gene?: string | null;
  /** Global-rank #1 gene for the queried trait at the locus (most distinct
   *  evidence categories, score-sum tiebreak). Only populated by traitLoci();
   *  NULL when the locus has no non-candidate evidence for the trait. */
  top_gene?: string | null;
}

export async function listLoci(): Promise<LocusRow[]> {
  const ds = getDataSource();
  try {
    return await ds.query<LocusRow>({
      sql:
        "SELECT locus_id, locus_name, chromosome, start_position, end_position, " +
        "       lead_rsid, lead_pvalue, n_signals, n_candidate_genes, source_tag " +
        "FROM main.loci ORDER BY chromosome, start_position",
    });
  } catch {
    return []; // derived layer not built yet (fresh/cleared DB)
  }
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
  try {
    return await ds.query<GeneRow>({
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
  } catch {
    return []; // derived layer not built yet (fresh/cleared DB)
  }
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
  try {
    return await ds.query<TraitRow>({
      sql:
        "SELECT t.id AS trait_id, t.label, " +
        "       COUNT(DISTINCT le.locus_id) AS n_loci, " +
        "       COUNT(DISTINCT le.gene_symbol) AS n_genes, " +
        "       COUNT(le.locus_id) FILTER (WHERE le.match_type <> 'candidate') AS n_evidence " +
        "FROM config.traits t " +
        // Loci are trait-scoped — count the trait's OWN loci/evidence (same-trait).
        "LEFT JOIN main.locus_evidence le " +
        "  ON le.locus_trait_id = t.id AND NOT le.is_cross_trait " +
        "GROUP BY t.id, t.label ORDER BY n_loci DESC, t.label",
    });
  } catch {
    // Derived layer (main.locus_evidence) not built yet — list traits from
    // config alone with zero counts, so the browse/landing still works on a
    // fresh-or-cleared DB (mirrors landingStats / listLoci resilience).
    return ds.query<TraitRow>({
      sql:
        "SELECT id AS trait_id, label, 0 AS n_loci, 0 AS n_genes, 0 AS n_evidence " +
        "FROM config.traits ORDER BY label",
    });
  }
}

// (Studies are not an Explore browse entity — a "study" is a proxy for a
// source-via-mapping, owned by the Sources tab. Loci carry their source_tag
// for provenance.)

// --- Landing stats ---

export interface LandingStats {
  traits: number;
  studies: number;
  loci: number;
  genomeBuild: string;
}

/** At-a-glance counts for the landing page. Resilient to a not-yet-built
 *  derived layer (main.loci may not exist) — loci falls back to 0. */
export async function landingStats(): Promise<LandingStats> {
  const ds = getDataSource();
  const one = async (sql: string): Promise<number> => {
    try {
      const [r] = await ds.query<{ n: number }>({ sql });
      return Number(r?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const [traits, studies, loci] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM config.traits"),
    one(
      "SELECT COUNT(DISTINCT source_id) AS n FROM config.mappings WHERE target = 'loci'",
    ),
    one("SELECT COUNT(*) AS n FROM main.loci"),
  ]);
  return { traits, studies, loci, genomeBuild: "hg38" };
}

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
export async function traitLoci(
  traitId: string,
  opts: { sourceTags?: string[] } = {},
): Promise<LocusRow[]> {
  const ds = getDataSource();
  // Loci are trait-scoped: a locus is OWNED by a trait (loci.trait_id), set by
  // its definition source. We list loci WHERE l.trait_id = ? — not "loci that
  // have evidence for the trait" — so an FEV1 GWAS's loci never appear under
  // another trait. Optionally restrict to chosen definition sources.
  //   top_gene    — GLOBAL-RANK #1 gene from the locus's SAME-TRAIT evidence
  //                 (most distinct categories, score-sum tiebreak). NULL when
  //                 no same-trait non-candidate evidence.
  //   nearest_gene— ARG_MIN(gene, distance) from the lead/source variant
  //                 (midpoint fallback) to each candidate gene's body.
  const sourceTags = opts.sourceTags?.filter((s) => s.trim() !== "") ?? [];
  const sourceFilter = sourceTags.length
    ? ` AND l.source_tag IN (${sourceTags.map(() => "?").join(", ")})`
    : "";
  return ds.query<LocusRow>({
    sql:
      "SELECT l.locus_id, l.locus_name, l.chromosome, " +
      "       l.start_position, l.end_position, l.lead_rsid, l.lead_pvalue, " +
      "       l.n_signals, l.n_candidate_genes, l.source_tag, " +
      "       (SELECT COUNT(*) FROM main.locus_evidence le4 " +
      "          WHERE le4.locus_id = l.locus_id AND NOT le4.is_cross_trait " +
      "            AND le4.match_type <> 'candidate') AS n_evidence, " +
      "       (SELECT gene_symbol FROM ( " +
      "          SELECT le2.gene_symbol, " +
      "                 COUNT(DISTINCT le2.evidence_category) AS ncat, " +
      "                 COUNT(*) AS ninst " +
      "            FROM main.locus_evidence le2 " +
      "           WHERE le2.locus_id = l.locus_id AND NOT le2.is_cross_trait " +
      "             AND le2.match_type <> 'candidate' " +
      "             AND le2.gene_symbol IS NOT NULL " +
      "           GROUP BY le2.gene_symbol " +
      // Rank by breadth (distinct categories), then instance count — both
      // scale-free. NOT a value sum: open values aren't comparable across
      // categories/sources (see plan 2026-06-01-evidence-value-model).
      "           ORDER BY ncat DESC, ninst DESC, le2.gene_symbol " +
      "           LIMIT 1) ) AS top_gene, " +
      "       (SELECT ARG_MIN(g.gene_symbol, GREATEST(0, " +
      "                 g.\"start\" - COALESCE(l.lead_position, (l.start_position + l.end_position) / 2), " +
      "                 COALESCE(l.lead_position, (l.start_position + l.end_position) / 2) - g.\"end\")) " +
      "          FROM (SELECT DISTINCT gene_symbol FROM main.locus_evidence le3 " +
      "                 WHERE le3.locus_id = l.locus_id AND le3.gene_symbol IS NOT NULL) lg " +
      "          JOIN main.gene_reference g ON g.gene_symbol = lg.gene_symbol " +
      "         WHERE g.chromosome = l.chromosome) AS nearest_gene " +
      "FROM main.loci l " +
      "WHERE l.trait_id = ?" + sourceFilter + " " +
      "ORDER BY l.chromosome, l.start_position",
    params: [traitId, ...sourceTags],
  });
}

/** Distinct non-candidate evidence categories for a trait — populates the
 *  "Top gene by category" picker on the Traits page. */
export async function traitEvidenceCategories(
  traitId: string,
): Promise<string[]> {
  const ds = getDataSource();
  const rows = await ds.query<{ evidence_category: string }>({
    sql:
      "SELECT DISTINCT evidence_category FROM main.locus_evidence " +
      "WHERE locus_trait_id = ? AND NOT is_cross_trait AND match_type <> 'candidate' " +
      "  AND evidence_category IS NOT NULL AND evidence_category <> '' " +
      "ORDER BY evidence_category",
    params: [traitId],
  });
  return rows.map((r) => r.evidence_category);
}

/** Per-locus, per-category coverage for a trait: how many distinct genes in
 *  each locus carry evidence of each category. Returned as
 *  locus_id → (category → n_genes). One grouped scan (no joins); the caller
 *  divides by the locus's candidate-gene count to get a 0..1 coverage for the
 *  per-locus heatmap strip. */
export async function traitLocusCategoryCoverage(
  traitId: string,
): Promise<Map<string, Map<string, number>>> {
  const ds = getDataSource();
  const rows = await ds.query<{
    locus_id: string;
    evidence_category: string;
    n_genes: number | string;
  }>({
    sql:
      "SELECT locus_id, evidence_category, " +
      "       COUNT(DISTINCT gene_symbol) AS n_genes " +
      "FROM main.locus_evidence " +
      "WHERE locus_trait_id = ? AND NOT is_cross_trait AND match_type <> 'candidate' " +
      "  AND gene_symbol IS NOT NULL " +
      "  AND evidence_category IS NOT NULL AND evidence_category <> '' " +
      "GROUP BY locus_id, evidence_category",
    params: [traitId],
  });
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = out.get(r.locus_id);
    if (!m) {
      m = new Map();
      out.set(r.locus_id, m);
    }
    m.set(r.evidence_category, Number(r.n_genes));
  }
  return out;
}

/** Per-locus top gene WITHIN a single evidence category for a trait: the gene
 *  with the most evidence instances in that category at each locus. Returns a
 *  locus_id → gene_symbol map (loci with no gene in the category are absent;
 *  the UI falls back to the cytoband label for those). Ranks by instance count,
 *  not value sum — open values aren't comparable (see plan
 *  2026-06-01-evidence-value-model). */
export async function traitLociTopGeneByCategory(
  traitId: string,
  category: string,
): Promise<Map<string, string>> {
  const ds = getDataSource();
  const rows = await ds.query<{ locus_id: string; gene_symbol: string }>({
    sql:
      "SELECT locus_id, gene_symbol FROM ( " +
      "  SELECT le.locus_id, le.gene_symbol, " +
      "         ROW_NUMBER() OVER (PARTITION BY le.locus_id " +
      "           ORDER BY COUNT(*) DESC, le.gene_symbol) AS rn " +
      "    FROM main.locus_evidence le " +
      "   WHERE le.locus_trait_id = ? AND NOT le.is_cross_trait " +
      "     AND le.evidence_category = ? " +
      "     AND le.match_type <> 'candidate' AND le.gene_symbol IS NOT NULL " +
      "   GROUP BY le.locus_id, le.gene_symbol " +
      ") WHERE rn = 1",
    params: [traitId, category],
  });
  return new Map(rows.map((r) => [r.locus_id, r.gene_symbol]));
}

/** Loci-definition sources that OWN loci for this trait (loci.trait_id) — the
 *  trait's "studies". Drives the track/list color legend and the source filter. */
export async function traitSourceTags(traitId: string): Promise<string[]> {
  const ds = getDataSource();
  const rows = await ds.query<{ source_tag: string }>({
    sql:
      "SELECT DISTINCT source_tag FROM main.loci " +
      "WHERE trait_id = ? AND source_tag IS NOT NULL ORDER BY source_tag",
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
      "WHERE locus_trait_id = ? AND NOT is_cross_trait " +
      "  AND match_type <> 'candidate' AND source_tag IS NOT NULL " +
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

/** Build LocusGene[] for the evidence heatmap at one locus. The locus is
 *  trait-scoped, so by default we show its SAME-TRAIT evidence (NOT
 *  is_cross_trait) plus candidate stubs (neighborhood genes). With
 *  `crossTrait`, also include cross-trait (pleiotropy) evidence — other traits
 *  with signals overlapping this locus. Genes whose only rows are candidate
 *  stubs come back with an empty evidence[] = neighborhood genes. */
export async function locusGenes(
  locusId: string,
  opts: { crossTrait?: boolean } = {},
): Promise<LocusGene[]> {
  const ds = getDataSource();
  const crossClause = opts.crossTrait
    ? ""
    : "  AND (match_type = 'candidate' OR NOT is_cross_trait) ";
  const rows = await ds.query<{
    gene_symbol: string;
    match_type: string;
    evidence_category: string | null;
    source_tag: string | null;
    primary_value: number | string | null;
    secondary_value: number | string | null;
    primary_value_label: string | null;
    secondary_value_label: string | null;
    tissue: string | null;
    cell_type: string | null;
    ancestry: string | null;
    sex: string | null;
    detail: string | null;
  }>({
    sql:
      "SELECT gene_symbol, match_type, evidence_category, source_tag, " +
      "       primary_value, secondary_value, " +
      "       primary_value_label, secondary_value_label, " +
      "       tissue, cell_type, ancestry, sex, detail " +
      "FROM main.locus_evidence " +
      "WHERE locus_id = ? AND gene_symbol IS NOT NULL " +
      crossClause,
    params: [locusId],
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
      if (r.primary_value != null) ev.primary_value = r.primary_value;
      if (r.secondary_value != null) ev.secondary_value = r.secondary_value;
      if (r.primary_value_label != null)
        ev.primary_value_label = r.primary_value_label;
      if (r.secondary_value_label != null)
        ev.secondary_value_label = r.secondary_value_label;
      if (r.tissue != null) ev.tissue = r.tissue;
      if (r.cell_type != null) ev.cell_type = r.cell_type;
      if (r.ancestry != null) ev.ancestry = r.ancestry;
      if (r.sex != null) ev.sex = r.sex;
      if (r.detail != null) ev.detail = r.detail;
      g.evidence.push(ev);
    }
  }
  return [...byGene.values()].sort((a, b) =>
    a.gene_symbol.localeCompare(b.gene_symbol),
  );
}

// --- Locus detail ---

export async function getLocus(locusId: string): Promise<LocusRow | null> {
  const ds = getDataSource();
  const [row] = await ds.query<LocusRow>({
    sql:
      "SELECT locus_id, locus_name, chromosome, start_position, end_position, " +
      "       lead_rsid, lead_pvalue, n_signals, n_candidate_genes, source_tag " +
      "FROM main.loci WHERE locus_id = ? LIMIT 1",
    params: [locusId],
  });
  return row ?? null;
}

export interface TraitLink {
  trait_id: string;
  label: string;
  n_evidence: number;
  n_genes: number;
}

/** Traits implicated at a locus (have ≥1 non-candidate evidence row). */
export async function locusTraits(locusId: string): Promise<TraitLink[]> {
  const ds = getDataSource();
  return ds.query<TraitLink>({
    sql:
      "SELECT t.id AS trait_id, t.label, " +
      "       COUNT(*) AS n_evidence, " +
      "       COUNT(DISTINCT le.gene_symbol) AS n_genes " +
      "FROM main.locus_evidence le JOIN config.traits t ON t.id = le.trait_id " +
      "WHERE le.locus_id = ? AND le.match_type <> 'candidate' " +
      "GROUP BY t.id, t.label ORDER BY n_evidence DESC",
    params: [locusId],
  });
}

// --- Gene detail ---

export interface GeneDetail {
  gene_symbol: string;
  ensembl_gene_id: string | null;
  chromosome: string | null;
  start: number | null;
  end: number | null;
  strand: string | null;
  gene_type: string | null;
}

export async function getGene(symbol: string): Promise<GeneDetail | null> {
  const ds = getDataSource();
  const [row] = await ds.query<GeneDetail>({
    sql:
      "SELECT gene_symbol, ensembl_gene_id, chromosome, start, \"end\", strand, " +
      "       gene_type FROM main.gene_reference WHERE gene_symbol = ? LIMIT 1",
    params: [symbol],
  });
  return row ?? null;
}

/** Loci implicating a gene (it appears in their locus_evidence). */
export async function geneLoci(symbol: string): Promise<LocusRow[]> {
  const ds = getDataSource();
  return ds.query<LocusRow>({
    sql:
      "SELECT DISTINCT l.locus_id, l.locus_name, l.chromosome, " +
      "       l.start_position, l.end_position, l.lead_rsid, l.lead_pvalue, " +
      "       l.n_signals, l.n_candidate_genes, l.source_tag " +
      "FROM main.loci l JOIN main.locus_evidence le ON le.locus_id = l.locus_id " +
      "WHERE le.gene_symbol = ? ORDER BY l.chromosome, l.start_position",
    params: [symbol],
  });
}

/** Traits with evidence for a gene. */
export async function geneTraits(symbol: string): Promise<TraitLink[]> {
  const ds = getDataSource();
  return ds.query<TraitLink>({
    sql:
      "SELECT t.id AS trait_id, t.label, " +
      "       COUNT(*) AS n_evidence, " +
      "       COUNT(DISTINCT le.locus_id) AS n_genes " + // n_genes column reused as n_loci
      "FROM main.locus_evidence le JOIN config.traits t ON t.id = le.trait_id " +
      "WHERE le.gene_symbol = ? AND le.match_type <> 'candidate' " +
      "GROUP BY t.id, t.label ORDER BY n_evidence DESC",
    params: [symbol],
  });
}

export interface GeneEvidenceRow {
  evidence_category: string | null;
  source_tag: string | null;
  trait_label: string | null;
  // Open per-category values + labels (raw, per-instance — honest here; not
  // aggregated across categories).
  primary_value: number | string | null;
  secondary_value: number | string | null;
  primary_value_label: string | null;
  secondary_value_label: string | null;
  // Attributes.
  tissue: string | null;
  cell_type: string | null;
  ancestry: string | null;
  sex: string | null;
  detail: string | null;
}

/** Evidence INSTANCES for a gene, across all its loci/traits — one row per
 *  measurement. The gene page groups these by category (count = the per-category
 *  summary; values shown per-instance on expand). Raw values appear only here,
 *  where they're honest — never aggregated across categories (open, incomparable
 *  scales). */
export async function geneEvidence(symbol: string): Promise<GeneEvidenceRow[]> {
  const ds = getDataSource();
  return ds.query<GeneEvidenceRow>({
    sql:
      "SELECT le.evidence_category, le.source_tag, t.label AS trait_label, " +
      "       le.primary_value, le.secondary_value, " +
      "       le.primary_value_label, le.secondary_value_label, " +
      "       le.tissue, le.cell_type, le.ancestry, le.sex, le.detail " +
      "FROM main.locus_evidence le " +
      "LEFT JOIN config.traits t ON t.id = le.trait_id " +
      "WHERE le.gene_symbol = ? AND le.match_type <> 'candidate' " +
      "ORDER BY le.evidence_category, le.source_tag",
    params: [symbol],
  });
}
