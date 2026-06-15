// Canonical evidence-table fields a mapping can assign. Order is the
// recommended display order.

// Column-mapped canonical fields a mapping can assign: MATCH KEYS (how evidence
// binds to loci/genes) + ATTRIBUTES (the context a measurement was taken in).
// The numeric VALUES (primary_value / secondary_value) are NOT here — they're
// mapping-level columns projected specially (see evidence.ts), because a value
// is open and per-category, not a universal attribute. pvalue/effect_size/
// evidence_stream were dropped: they're type-specific VALUES, not attributes —
// an effect size now goes in secondary_value (labeled), not its own field.
export const CANONICAL_FIELDS = [
  "gene_symbol",
  "chromosome",
  "position",
  "rsid",
  "tissue",
  "cell_type",
  "ancestry",
  "sex",
  // Free-text per-row annotation for qualitative evidence with no numeric value
  // (e.g. a rare-disease name, a mouse-KO phenotype, an eQTL tissue, a drug
  // indication). Never a match key; always optional.
  "detail",
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
