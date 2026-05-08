import type { TrackLayout } from "./use-track-layout";
import { CHROM_FILLS } from "../../lib/colors";

type Props = {
  layout: TrackLayout;
  barY: number;
  barHeight: number;
};

const CHROM_GAP = 2; // pixel gap between chromosome segments

/**
 * Separate rounded-corner segments for each chromosome with small gaps.
 * Labels centered above each segment.
 */
export function ChromosomeTrack({ layout, barY, barHeight }: Props) {
  return (
    <g className="chromosome-track">
      {layout.visibleChroms.map(({ chr, startPx, widthPx }) => {
        const chrIndex = layout.chroms.findIndex((c) => c.name === chr);
        const fill = CHROM_FILLS[chrIndex % 2];
        const segX = startPx + CHROM_GAP / 2;
        const segW = Math.max(widthPx - CHROM_GAP, 1);
        const labelX = startPx + widthPx / 2;
        const showLabel = widthPx > 28;

        return (
          <g key={chr}>
            <rect
              x={segX}
              y={barY}
              width={segW}
              height={barHeight}
              fill={fill}
              rx={barHeight / 2}
            />
            {showLabel && (
              <text
                x={labelX}
                y={barY + barHeight + 10}
                textAnchor="middle"
                className="fill-base-content/50"
                fontSize={Math.min(9, widthPx * 0.3)}
                fontWeight={400}
              >
                {chr}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
