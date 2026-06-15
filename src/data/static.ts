// Mirrors EVIDENCE_CATEGORIES in cli/src/pegasus_v2f/pegasus_schema.py.
// Static — no DB query needed.
export const EVIDENCE_CATEGORIES: Record<string, string> = {
  LD: "Linkage Disequilibrium",
  FM: "Finemapping / Credible Sets",
  COLOC: "Colocalization",
  QTL: "Molecular QTL",
  MR: "Mendelian Randomization",
  REG: "Regulatory Region",
  "3D": "Chromatin Interaction",
  FUNC: "Predicted Functional Impact",
  PROX: "Proximity to Gene",
  GWAS: "GWAS Association",
  PHEWAS: "Phenome-Wide Association",
  PPI: "Protein-Protein Interaction",
  SET: "Pathway or Gene Sets",
  GENEBASE: "Gene-based Association",
  EXP: "Expression",
  PERTURB: "Perturbation",
  KNOW: "Biological Knowledge",
  TPWAS: "Genetically Predicted Trait",
  DRUG: "Drug Related",
  CROSSP: "Cross-phenotype",
  LIT: "Literature Curation",
  DB: "Curated Database",
};

// One canonical HSL hue (0–360) per evidence category — the SINGLE source of
// truth for category color across the whole app. The locus heatmap, the
// per-locus coverage strips, the gene-evidence heatmap, and the evidence badge
// all derive their fill from this, so a category looks the same everywhere.
// 22 distinct hues (one per category, no repeats), scattered around the wheel
// so adjacent categories in a column read as clearly different colors. Keys
// MUST match EVIDENCE_CATEGORIES above.
export const CATEGORY_HUES: Record<string, number> = {
  LD: 0,
  FM: 115,
  COLOC: 229,
  QTL: 344,
  MR: 98,
  REG: 213,
  "3D": 327,
  FUNC: 82,
  PROX: 196,
  GWAS: 311,
  PHEWAS: 65,
  PPI: 180,
  SET: 295,
  GENEBASE: 49,
  EXP: 164,
  PERTURB: 278,
  KNOW: 33,
  TPWAS: 147,
  DRUG: 262,
  CROSSP: 16,
  LIT: 131,
  DB: 245,
};

/** Hue for a category, usable directly in hsl()/hsla(). Unknown codes get a
 *  neutral blue-gray fallback (no canonical category should hit it). */
export function categoryHue(cat: string): number {
  return CATEGORY_HUES[cat] ?? 220;
}

// Default value labels suggested per category in the mapping form. These are
// only PREFILLS — values stay open (map any numeric) and labels are stored
// per-mapping and editable; this just saves typing the common case. Categories
// with no clear convention are omitted (no default; the label stays blank
// unless the user types one). `primary` describes the main value, `secondary`
// the optional second number (e.g. effect direction/magnitude).
export const CATEGORY_VALUE_LABELS: Record<
  string,
  { primary?: string; secondary?: string }
> = {
  GWAS: { primary: "−log10 p", secondary: "effect size" },
  PHEWAS: { primary: "−log10 p", secondary: "effect size" },
  GENEBASE: { primary: "−log10 p" },
  TPWAS: { primary: "−log10 p", secondary: "effect size" },
  CROSSP: { primary: "−log10 p" },
  QTL: { primary: "−log10 p", secondary: "effect size" },
  MR: { primary: "−log10 p", secondary: "effect size" },
  COLOC: { primary: "posterior probability" },
  FM: { primary: "posterior inclusion probability" },
  LD: { primary: "r²" },
  PROX: { primary: "distance (bp)" },
  FUNC: { primary: "functional score" },
  REG: { primary: "regulatory score" },
  "3D": { primary: "interaction score" },
  PPI: { primary: "interaction score" },
  SET: { primary: "enrichment score" },
  EXP: { primary: "expression", secondary: "log2 fold change" },
  PERTURB: { primary: "effect score" },
};
