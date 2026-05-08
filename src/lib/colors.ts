/**
 * Tableau 20 palette — 10 dark/light pairs.
 * Each pair shares a hue; the second entry is a lighter tint.
 */
export const TABLEAU_20 = [
  "#4e79a7", "#a0cbe8", // blue
  "#f28e2b", "#ffbe7d", // orange
  "#e15759", "#ff9d9a", // red
  "#76b7b2", "#9dd0cc", // teal
  "#59a14f", "#8cd17d", // green
  "#edc948", "#f1e47d", // yellow
  "#b07aa1", "#d4a6c8", // purple
  "#ff9da7", "#ffb7c1", // pink
  "#9c755f", "#bab0ac", // brown
  "#bab0ac", "#d7d3cf", // gray
] as const;

/** Just the 10 dark (saturated) colors. */
export const TABLEAU_10 = TABLEAU_20.filter((_, i) => i % 2 === 0);

/** Just the 10 light (tint) colors. */
export const TABLEAU_10_LIGHT = TABLEAU_20.filter((_, i) => i % 2 === 1);

/** Chromosome track colors — light orange / light purple from Tableau 20. */
export const CHROM_FILLS = [TABLEAU_20[3], TABLEAU_20[13]] as const; // #ffbe7d, #d4a6c8

/** Study color palette for multi-study disambiguation. */
export const STUDY_PALETTE = [
  "#6366f1", "#ec4899", "#14b8a6", "#f59e0b",
  "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16",
];
