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

// Required canonical fields depend on the mapping target (and, for evidence, on
// its centric kind):
//   - evidence + gene     → gene_symbol (the row key; matched to loci by name)
//   - evidence + variant  → chromosome + position (matched to loci by position,
//     then fanned to the locus's candidate genes — no gene column needed)
//   - loci                → chromosome + position (window/merge inputs)
// These are auto-provided in the field list and can't be removed.
export function requiredFields(
  target: string,
  centric?: string,
): readonly string[] {
  if (target === "loci") return ["chromosome", "position"];
  if (target === "evidence") {
    return centric === "variant" ? ["chromosome", "position"] : ["gene_symbol"];
  }
  return ["gene_symbol"];
}
