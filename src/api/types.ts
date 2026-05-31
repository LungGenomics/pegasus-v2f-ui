// --- Genes ---

export interface GeneSearchResult {
  gene: string;
  ensembl_gene_id: string;
  chromosome?: string;
  best_rank?: number | string;
  n_loci?: number | string;
  n_studies?: number | string;
  is_any_effector?: number | string;
  evidence_categories?: string;
  searchable_text?: string;
  score?: number;
  [key: string]: unknown;
}

export interface Gene {
  gene_symbol: string;
  ensembl_gene_id: string;
  gene_name: string;
  chromosome: string;
  start_position: number;
  end_position: number;
  strand: string;
  genome_build: string;
  [key: string]: unknown;
}

export interface GeneEvidence {
  gene_symbol: string;
  evidence_category: string;
  evidence_level: "locus" | "gene";
  source_tag: string;
  score: number | string;
  // Locus-level fields
  locus_id?: string;
  evidence_stream?: string;
  pvalue?: number | string;
  effect_size?: number | string;
  tissue?: string;
  cell_type?: string;
  is_supporting?: boolean | string;
  // Gene-level fields
  evidence_type?: string;
  trait?: string;
}

export interface GeneScore {
  locus_id: string;
  gene_symbol: string;
  integration_rank: number | string;
  is_predicted_effector: boolean | string;
  match_type: string;
  n_candidate_genes: number | string;
  locus_name: string;
  chromosome: string;
  start_position: number;
  end_position: number;
  study_id: string;
  trait?: string;
}

// --- Studies ---

export interface Study {
  study_id: string;
  trait: string;
  trait_description: string;
  trait_ontology_id: string;
  study_description: string;
  gwas_source: string;
  ancestry: string;
  sample_size: number | string;
  doi: string;
  year: number | string;
  n_loci: number | string;
}

export interface StudyDetail extends Study {
  n_loci_actual?: number;
  n_candidate_genes?: number;
  n_effectors?: number;
  evidence_categories?: string[];
  [key: string]: unknown;
}

export interface Locus {
  locus_id: string;
  locus_name: string;
  chromosome: string;
  start_position: number;
  end_position: number;
  lead_variant_id: string;
  lead_rsid: string;
  lead_pvalue: number | string;
  locus_source: string;
  n_signals: number | string;
  n_candidate_genes: number | string;
  nearest_gene?: string;
  study_id?: string;
  trait?: string;
  top_gene?: string;
  top_gene_score?: number | string;
}

export interface Effector {
  locus_id: string;
  locus_name: string;
  chromosome: string;
  start_position: number;
  end_position: number;
  gene_symbol: string;
  integration_score: number | string;
  integration_rank: number | string;
  is_predicted_effector: boolean | string;
}

// --- Locus evidence matrix ---

// One evidence row for a (locus, gene) cell — real locus_evidence columns
// (pass-through source values mapped to a PEGASUS category), NOT the dropped
// integration scoring.
export interface LocusGeneEvidence {
  evidence_category: string;
  evidence_stream?: string;
  source_tag: string;
  pvalue?: number | string;
  effect_size?: number | string;
  score?: number | string;
  tissue?: string;
  cell_type?: string;
  ancestry?: string;
  sex?: string;
}

// A gene at a locus + its evidence rows. The redesign dropped the computed
// integration columns (rank/score/effector); the heatmap derives its "#"
// column live as COUNT(DISTINCT evidence_category). An empty `evidence` array
// = a candidate (neighborhood) gene with no evidence.
export interface LocusGene {
  gene_symbol: string;
  evidence: LocusGeneEvidence[];
}

// --- Traits (client-side grouping) ---

export interface TraitGroup {
  trait: string;
  traitDescription: string;
  studies: Study[];
  totalLoci: number;
}

// --- Sources ---

export interface Source {
  name: string;
  source_type: string;
  url?: string;
  display_name?: string;
  description?: string;
  data_type?: string;
  [key: string]: unknown;
}

export interface SourceProvenance {
  source_tag: string;
  source_name: string;
  source_type: string;
  evidence_category: string;
  is_integrated: boolean | string;
  version: string;
  url: string;
  citation: string;
  date_imported: string;
  record_count: number | string;
}

/** Source rollup for one trait — how much each source contributed across
 *  the trait's studies. Returned by `sourcesForTrait` query. */
export interface SourceContribution {
  source_tag: string;
  evidence_category: string;
  record_count: number | string;
  n_genes: number | string;
  n_loci: number | string;
}

export interface SourceLocus {
  locus_id: string;
  locus_name: string;
  chromosome: string;
  start_position: number;
  end_position: number;
  lead_pvalue: number | null;
  n_genes: number;
  max_score: number;
}

export interface SourceEvidenceRow {
  locus_id: string;
  locus_name: string;
  study_id: string;
  gene_symbol: string;
  evidence_category: string;
  pvalue: number | string | null;
  effect_size: number | string | null;
  score: number | string | null;
  tissue: string | null;
  cell_type: string | null;
  ancestry: string | null;
  sex: string | null;
  rsid: string | null;
}

export interface SourceDataProfile {
  has_positions: boolean;
  has_scores: boolean;
  has_pvalues: boolean;
}

export interface SourceEvidenceResponse {
  loci: SourceLocus[];
  evidence: SourceEvidenceRow[];
  data_profile: SourceDataProfile;
}

export interface SourceVariant {
  chromosome: string;
  position: number;
  rsid: string | null;
  gene_symbol: string;
  pvalue: number | string | null;
  effect_size: number | string | null;
  score: number | string | null;
  tissue: string | null;
  cell_type: string | null;
}

export interface ImportRequest {
  name: string;
  data: Record<string, unknown>[];
  description?: string;
  display_name?: string;
  data_type?: string;
  source_type?: string;
  gene_column?: string;
  include_in_search?: boolean;
  url?: string;
  sheet?: string;
  skip_rows?: number;
}

export interface ImportResult {
  success: boolean;
  imported?: string;
  rows?: number;
  error?: string;
}

export interface MutationResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// --- DB ---

export interface ChromSizes {
  names: string[];
  lengths: number[];
}

export interface DbStatus {
  n_studies: number;
  n_loci: number;
  n_genes: number;
  n_evidence_rows: number;
  n_sources: number;
  has_pegasus: boolean;
  genome_build: string;
  package_version: string;
}

export interface TableInfo {
  name: string;
  row_count: number;
  [key: string]: unknown;
}

export type EvidenceCategories = Record<string, string>;

// --- Redesigned config types ---
// Per plan 2026-05-11-config-redesign-web-first.md. These are the new
// shapes returned by the data-layer ops (sourceOps, derivationOps,
// traitOps). The legacy V2fSourceConfig / V2fStudyConfig / V2fConfig
// types below are kept for the duration of the UI transition and will
// be removed once Phase 4 (source detail editor) lands.

export interface ConfigSource {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  source_type: string;
  url?: string;
  sheet?: string;
  skip_rows?: number;
  row_version?: number;
  /** GitHub login of the user who created / last edited this source. NULL
   *  when the write happened without a signed-in session. */
  created_by?: string;
  last_edited_by?: string;
  created_at?: string;
  updated_at?: string;
  /** Optional citation metadata (gwas_source, ancestry, etc.) when this
   *  source represents a published study. Populated by listSources /
   *  getSource via a LEFT JOIN. */
  citation?: SourceCitation;
  /** Declared trait associations — `config.source_traits` rows. For
   *  sources whose trait is per-row, the mapping carries that info
   *  instead and this stays empty. */
  trait_ids?: string[];
  /** Source-level transform pipeline (cleans the raw). Loaded by
   *  getSource / listSourceTransforms. */
  transforms?: ConfigSourceTransform[];
}

export interface SourceCitation {
  source_id: string;
  gwas_source?: string;
  ancestry?: string;
  sample_size?: number;
  doi?: string;
  year?: number;
  pubmed_id?: string;
  updated_at?: string;
}

export type MappingTarget = "evidence" | "loci";
export type MappingCentric = "variant" | "gene";
export type MappingTraitScope = "constant" | "column";

/** Transform DSL step that cleans the raw table. Source-level — shared by
 *  all of the source's mappings (config.source_transforms). */
export interface ConfigSourceTransform {
  seq: number;
  type: string;
  params: Record<string, unknown>;
}

/** The projection unit (replaces ConfigDerivation): a cleaned source →
 *  one output stream. target='evidence' emits evidence rows; target='loci'
 *  builds loci with per-mapping window/merge. */
export interface ConfigMapping {
  id: string;
  source_id: string;
  source_tag: string;
  display_name?: string;
  target: MappingTarget;
  /** Set when target='evidence'. */
  evidence_category?: string;
  /** Source column whose value is each evidence row's score (plain alias, no
   *  calculation). Required for target='evidence'. */
  score_column?: string;
  centric?: MappingCentric;
  trait_scope?: MappingTraitScope;
  /** Set when target='loci' (per-mapping loci resolution). */
  window_kb?: number;
  merge_distance_kb?: number;
  row_version?: number;
  created_by?: string;
  last_edited_by?: string;
  created_at?: string;
  updated_at?: string;
  /** Loaded by getMapping / listMappingsForSource. */
  fields?: MappingField[];
  /** When trait_scope = 'constant'. */
  trait_ids?: string[];
  /** When trait_scope = 'column'. */
  trait_column?: MappingTraitColumn;
}

export interface MappingField {
  canonical_field: string;
  raw_column: string;
}

export interface MappingTraitColumn {
  raw_column: string;
  trait_id_lookup?: string;
}

export interface ConfigTrait {
  id: string;
  label: string;
  description?: string;
  primary_ontology?: string;
  primary_ontology_id?: string;
  ontology_label?: string;
  xrefs?: TraitXref[];
  ontology_version?: string;
  parent_trait_id?: string;
  trait_kind?: "measurement" | "disease" | "phenotype" | "other";
  /** True when trait_kind was set by an admin override — enrichment then
   *  preserves it instead of re-inferring from the ontology ancestors. */
  trait_kind_overridden?: boolean;
  synonyms?: string[];
  hierarchy_path?: TraitHierarchyNode[];
  ot_phenotypes?: TraitPhenotype[];
  ot_drugs?: TraitDrug[];
  ot_therapeutic_areas?: string[];
  last_enriched_at?: string;
  row_version?: number;
  created_by?: string;
  last_edited_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TraitXref {
  onto: string;
  id: string;
  label?: string;
}

export interface TraitHierarchyNode {
  id: string;
  label: string;
}

export interface TraitPhenotype {
  hpo_id: string;
  label: string;
  frequency?: string;
  onset?: string;
  modifier?: string;
}

export interface TraitDrug {
  chembl_id: string;
  name: string;
  max_phase?: number;
  mechanism_of_action?: string;
}

// --- Config (v2f.yaml) ---

export interface V2fEvidenceBlock {
  source_tag: string;
  category: string;
  centric?: string;
  role?: string;
  fields?: Record<string, string>;
  [key: string]: unknown;
}

export interface V2fSourceConfig {
  name: string;
  source_type: string;
  url?: string;
  path?: string;
  sheet?: string;
  skip_rows?: number;
  gene_column?: string;
  display_name?: string;
  transformations?: TransformConfigEntry[];
  evidence?: V2fEvidenceBlock[];
  [key: string]: unknown;
}

export interface TransformConfigEntry {
  type: string;
  column?: string;
  columns?: Record<string, string> | string[] | string;
  pattern?: string;
  prefix?: string;
  delimiter?: string;
  index?: number;
  output?: string;
  group_by?: string | string[];
  agg?: Record<string, string>;
  expression?: string;
  from?: string;
  to?: string;
  drop_unmapped?: boolean;
  [key: string]: unknown;
}

export interface V2fStudyConfig {
  id_prefix: string;
  traits: string[];
  loci_source?: string;
  loci_sheet?: string;
  loci_skip?: number;
  gene_column?: string;
  sentinel_column?: string;
  pvalue_column?: string;
  rsid_column?: string;
  gwas_source?: string;
  ancestry?: string;
  sample_size?: number;
  doi?: string;
  year?: number;
  transformations?: TransformConfigEntry[];
  [key: string]: unknown;
}

export interface V2fConfig {
  version?: number;
  database?: {
    backend?: string;
    genome_build?: string;
    name?: string;
    [key: string]: unknown;
  };
  data_sources?: V2fSourceConfig[];
  pegasus?: {
    study?: V2fStudyConfig[];
    locus_definition?: {
      window_kb?: number;
      merge_distance_kb?: number;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- Stack item (computed from config + DB status) ---

export interface SourceStackItem {
  name: string;
  displayName: string;
  category: string;
  sourceType: string;
  transformCount: number;
  evidenceCount: number;
  status: "configured" | "built";
  dbRowCount?: number;
}

export interface StudyStackItem {
  idPrefix: string;
  traits: string[];
  gwasSource?: string;
  ancestry?: string;
  status: "configured" | "built";
}
