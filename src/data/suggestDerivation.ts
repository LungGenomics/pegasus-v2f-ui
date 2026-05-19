// "Suggest a derivation" heuristic (Phase 3). Pure, deterministic, and
// conservative: given a raw table's column names, propose a mapping
// (canonical field → raw column), a centric guess, and a trait scope.
// It only pre-fills a derivation block the user then reviews/edits, so
// it deliberately under-maps rather than risk a wrong guess — matching
// is by exact normalized name or whole-token, never loose substring
// (which would map "position" from "composite_pos", etc.).

import type { CanonicalField } from "./canonicalFields";

export interface SuggestedDerivation {
  /** canonical_field → raw_column */
  mappings: Record<string, string>;
  centric: "variant" | "gene";
  trait_scope: "constant" | "column";
  /** set when trait_scope === "column" */
  trait_column?: string;
}

/** Synonyms per canonical field, in normalized form (lowercased,
 *  non-alphanumerics stripped). */
const SYNONYMS: Record<CanonicalField, string[]> = {
  gene_symbol: ["genesymbol", "gene", "genename", "symbol", "hgnc", "hgncsymbol"],
  chromosome: ["chr", "chrom", "chromosome", "chrname"],
  position: [
    "pos",
    "position",
    "bp",
    "basepair",
    "basepairlocation",
    "start",
    "startposition",
    "location",
  ],
  rsid: ["rsid", "rs", "snp", "snpid", "variant", "variantid", "marker"],
  pvalue: ["p", "pval", "pvalue", "pvalues", "pvaluegc"],
  effect_size: [
    "beta",
    "effect",
    "effectsize",
    "es",
    "or",
    "oddsratio",
    "logfc",
    "log2foldchange",
    "logodds",
  ],
  score: ["score", "pip", "posterior", "posteriorprob", "zscore", "z", "weight"],
  tissue: ["tissue", "tissuename"],
  cell_type: ["celltype", "cell", "celltypename"],
  ancestry: ["ancestry", "population", "pop", "ethnicity"],
  sex: ["sex", "gender"],
  evidence_stream: ["evidencestream", "stream", "method", "submethod", "qtltype"],
};

const TRAIT_SYNONYMS = [
  "trait",
  "phenotype",
  "traitname",
  "phenotypename",
  "traitlabel",
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Best raw column for a synonym set, from the not-yet-used pool.
 *  Exact normalized match wins; otherwise a whole-token match. */
function pick(
  rawColumns: string[],
  used: Set<string>,
  syns: string[],
): string | undefined {
  const synSet = new Set(syns);
  let tokenMatch: string | undefined;
  for (const col of rawColumns) {
    if (used.has(col)) continue;
    if (synSet.has(norm(col))) return col; // exact — best
    if (!tokenMatch && tokens(col).some((t) => synSet.has(t))) {
      tokenMatch = col; // whole-token — acceptable fallback
    }
  }
  return tokenMatch;
}

export function suggestDerivation(
  rawColumns: string[],
): SuggestedDerivation {
  const used = new Set<string>();
  const mappings: Record<string, string> = {};

  // SYNONYMS is declared in canonical display order, so its key order
  // matches CANONICAL_FIELDS without importing it at runtime.
  const fields = Object.keys(SYNONYMS) as CanonicalField[];
  for (const field of fields) {
    const hit = pick(rawColumns, used, SYNONYMS[field]);
    if (hit) {
      mappings[field] = hit;
      used.add(hit);
    }
  }

  // variant-centric only if we found genomic coordinates; otherwise the
  // source is gene-level.
  const centric: "variant" | "gene" =
    mappings.chromosome && mappings.position ? "variant" : "gene";

  // A per-row trait column → column scope; else constant (user picks
  // the trait(s) on the block).
  const traitCol = pick(rawColumns, used, TRAIT_SYNONYMS);
  const trait_scope: "constant" | "column" = traitCol ? "column" : "constant";

  return {
    mappings,
    centric,
    trait_scope,
    ...(traitCol ? { trait_column: traitCol } : {}),
  };
}
