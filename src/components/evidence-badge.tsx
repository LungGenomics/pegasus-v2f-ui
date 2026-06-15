import { categoryHue } from "../data/static";

// A category chip colored from the single canonical palette (data/static.ts).
// Soft tint so the same hue stays legible across all 22 categories: light
// background, dark text, faint border — all derived from the category's hue.
export function EvidenceBadge({ category }: { category: string }) {
  const h = categoryHue(category);
  return (
    <span
      className="badge badge-sm border"
      style={{
        backgroundColor: `hsl(${h} 85% 93%)`,
        color: `hsl(${h} 60% 30%)`,
        borderColor: `hsl(${h} 70% 50% / 0.35)`,
      }}
    >
      {category}
    </span>
  );
}
