// Canonical evidence-table fields a derivation's mapping can assign.
// Relocated out of the (now-retired) Add Data wizard so the blocks UI
// (derivation-card) and the suggest-a-derivation heuristic have a
// stable, wizard-independent home. `gene_symbol` is the only required
// mapping; order is the recommended display order.

export const CANONICAL_FIELDS = [
  "gene_symbol",
  "chromosome",
  "position",
  "rsid",
  "pvalue",
  "effect_size",
  "score",
  "tissue",
  "cell_type",
  "ancestry",
  "sex",
  "evidence_stream",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const REQUIRED_FIELDS = new Set<string>(["gene_symbol"]);
