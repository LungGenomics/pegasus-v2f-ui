import type { TrackLayout } from "./use-track-layout";
import type { TrackItem, TrackLocus } from "./types";
import { isCluster } from "./types";

type Props = {
  items: TrackItem[];
  layout: TrackLayout;
  barY: number;
  selectedLocusId?: string;
  /** Locus under the cursor in the loci list — its marker grows slightly and
   *  shows its label (even when zoomed out / clustered), mirroring the list↔
   *  track link. No glow/shadow, just a size bump. */
  hoveredLocusId?: string;
  traitColors?: Record<string, string>;
};

const TRI_WIDTH = 7;
const TRI_HEIGHT = 6;
const DEFAULT_COLOR = "#6366f1"; // indigo-500
const MIXED_COLOR = "#9ca3af"; // gray-400 — used for clusters with mixed traits

/**
 * Renders locus markers as downward-pointing triangles sitting on top
 * of the chromosome bar. Tip touches the bar top edge.
 */
export function LocusMarkers({
  items,
  layout,
  barY,
  selectedLocusId,
  hoveredLocusId,
  traitColors,
}: Props) {
  return (
    <g className="locus-markers">
      {items.map((item, i) => {
        if (isCluster(item)) {
          const cx = item.centerPixel;
          // Use trait color if all loci share the same trait, otherwise default
          const traits = new Set(item.loci.map((l) => l.trait).filter(Boolean));
          const color =
            traits.size === 1
              ? (traitColors?.[traits.values().next().value!] ?? DEFAULT_COLOR)
              : MIXED_COLOR;
          // The hovered locus may be folded into this cluster — surface it: grow
          // the cluster marker and show that locus's label instead of the count.
          const hoveredLocus = hoveredLocusId
            ? item.loci.find((l) => l.id === hoveredLocusId)
            : undefined;
          const isHov = !!hoveredLocus;
          const w = isHov ? 9 : TRI_WIDTH;
          const h = isHov ? 8 : TRI_HEIGHT;
          const tipY = barY - 2;
          const topY = tipY - h;

          // Triangle
          const tri = `M ${cx - w / 2} ${topY} L ${cx + w / 2} ${topY} L ${cx} ${tipY} Z`;

          return (
            <g key={`cluster-${i}`}>
              <path d={tri} fill={color} opacity={isHov ? 0.9 : 0.5} />
              {isHov ? (
                /* Hovered: show the locus's label vertically, matching the
                   individual-marker labels. */
                <text
                  x={0}
                  y={0}
                  textAnchor="start"
                  dominantBaseline="central"
                  className="fill-base-content/80"
                  fontSize={8}
                  fontWeight={600}
                  transform={`translate(${cx}, ${topY - 3}) rotate(-90)`}
                >
                  {hoveredLocus!.label}
                </text>
              ) : (
                /* Default: the cluster count, horizontal above the triangle. */
                <text
                  x={cx}
                  y={topY - 3}
                  textAnchor="middle"
                  className="fill-base-content/50"
                  fontSize={7}
                  fontWeight={600}
                >
                  {item.count}
                </text>
              )}
            </g>
          );
        }

        const locus = item as TrackLocus;
        const midBp = (locus.start + locus.end) / 2;
        const cx = layout.bpToPixel(locus.chr, midBp);
        const isSelected = locus.id === selectedLocusId;
        const isHovered = !isSelected && locus.id === hoveredLocusId;
        const color = isSelected
          ? "#000000"
          : (traitColors?.[locus.trait ?? ""] ?? DEFAULT_COLOR);
        const opacity = isSelected || isHovered ? 1.0 : 0.7;
        const w = isSelected ? 10 : isHovered ? 9 : TRI_WIDTH;
        const h = isSelected ? 9 : isHovered ? 8 : TRI_HEIGHT;
        const tipY = barY - 2;
        const topY = tipY - h;

        const tri = `M ${cx - w / 2} ${topY} L ${cx + w / 2} ${topY} L ${cx} ${tipY} Z`;

        return (
          <g key={locus.id}>
            <path d={tri} fill={color} opacity={opacity} />
            {/* Label (shown when zoomed in, selected, or hovered in the list) */}
            {(isSelected || isHovered || layout.bpPerPixel < 500_000) && (
              <text
                x={0}
                y={0}
                textAnchor="start"
                dominantBaseline="central"
                fill={isSelected ? "#000000" : undefined}
                className={
                  isSelected
                    ? undefined
                    : isHovered
                      ? "fill-base-content/80"
                      : "fill-base-content/50"
                }
                fontSize={isSelected ? 9 : isHovered ? 8 : 7}
                fontWeight={600}
                transform={`translate(${cx}, ${topY - 3}) rotate(-90)`}
              >
                {locus.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
