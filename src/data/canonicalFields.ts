// Canonical evidence-table fields a mapping can assign. Order is the
// recommended display order.

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

// Required canonical fields depend on the mapping target:
//   - evidence → gene_symbol (the row key)
//   - loci     → chromosome + position (the window/merge inputs; the loci
//     builder ignores gene_symbol)
// These are auto-provided in the field list and can't be removed.
export const REQUIRED_FIELDS_BY_TARGET: Record<string, readonly string[]> = {
  evidence: ["gene_symbol"],
  loci: ["chromosome", "position"],
};

export function requiredFields(target: string): readonly string[] {
  return REQUIRED_FIELDS_BY_TARGET[target] ?? ["gene_symbol"];
}
