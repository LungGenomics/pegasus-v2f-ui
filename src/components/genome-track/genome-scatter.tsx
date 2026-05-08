import { useRef, useState, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import type { ViewState } from "./types";
import { useTrackLayout } from "./use-track-layout";
import { useGenomeZoom } from "./use-genome-zoom";
import { ChromosomeTrack } from "./chromosome-track";
import { CHROM_FILLS } from "../../lib/colors";

// --- Types ---

export type ScatterPoint = {
  id: string;
  chr: string;          // "chr1", "chr2", etc.
  pos: number;          // absolute bp position on chromosome
  y: number;            // score, -log10(p), etc.
  label: string;        // gene name or rsid
  locusId?: string;     // for linking to accordion
};

export type GenomeScatterProps = {
  points: ScatterPoint[];
  chromNames: string[];
  chromLengths: number[];
  yLabel?: string;
  thresholdY?: number;
  selectedPointId?: string;
  onPointSelect?: (id: string | null) => void;
  onViewChange?: (view: ViewState) => void;
  className?: string;
};

export type GenomeScatterHandle = {
  zoomToChrom: (chr: string) => void;
  zoomToRegion: (chr: string, start: number, end: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fullReset: () => void;
  hasLoci: boolean;
};

// --- Layout constants ---

const Y_AXIS_WIDTH = 40;       // left margin for y-axis labels
const PLOT_HEIGHT = 120;        // scatter plot area
const PLOT_TOP_PAD = 8;         // padding above max y
const BAR_HEIGHT = 4;
const CHR_LABEL_AREA = 12;
const GAP = 4;
const CONTENT_HEIGHT = PLOT_HEIGHT + GAP + BAR_HEIGHT + CHR_LABEL_AREA;
const ZOOM_PAD_TOP = 20;
const TOTAL_HEIGHT = ZOOM_PAD_TOP + CONTENT_HEIGHT;
const DOT_RADIUS = 2.5;

// --- Component ---

export const GenomeScatter = forwardRef<GenomeScatterHandle, GenomeScatterProps>(
  function GenomeScatter({
    points,
    chromNames,
    chromLengths,
    yLabel,
    thresholdY,
    selectedPointId,
    onPointSelect,
    onViewChange: onViewChangeProp,
    className,
  }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [view, setView] = useState<ViewState>({ startBp: 0, endBp: 1 });
    const [tooltip, setTooltip] = useState<{ x: number; y: number; point: ScatterPoint } | null>(null);

    // Measure container
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) setContainerWidth(entry.contentRect.width);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const plotWidth = Math.max(containerWidth - Y_AXIS_WIDTH, 0);

    const layout = useTrackLayout(plotWidth, view, chromNames, chromLengths);

    const onViewChange = useCallback(
      (v: ViewState) => {
        setView(v);
        onViewChangeProp?.(v);
      },
      [onViewChangeProp],
    );

    const { zoomTo, resetZoom, zoomIn, zoomOut } = useGenomeZoom(svgRef, {
      totalLength: layout.totalLength,
      containerWidth: plotWidth,
      onViewChange,
    });

    // Imperative handle for track controls
    useImperativeHandle(ref, () => ({
      zoomToChrom(chr: string) {
        const c = layout.chroms.find((ch) => ch.name === chr);
        const off = layout.offsets.get(chr);
        if (c && off != null) zoomTo(off, off + c.length);
      },
      zoomToRegion(chr: string, start: number, end: number) {
        const off = layout.offsets.get(chr);
        if (off != null) zoomTo(off + start, off + end);
      },
      zoomIn,
      zoomOut,
      fullReset: resetZoom,
      hasLoci: points.length > 0,
    }), [layout, zoomTo, resetZoom, zoomIn, zoomOut, points.length]);

    // Compute y-axis range from visible points
    const { yMin, yMax, visiblePoints } = useMemo(() => {
      const viewStart = view.startBp;
      const viewEnd = view.endBp;
      const viewSpan = viewEnd - viewStart;
      const totalSpan = layout.totalLength;
      const showAll = viewSpan >= totalSpan * 0.95;

      const vis: (ScatterPoint & { px: number })[] = [];

      for (const pt of points) {
        const px = layout.bpToPixel(pt.chr, pt.pos);
        // Include points within visible range (with generous buffer for labels)
        if (showAll || (px >= -50 && px <= plotWidth + 50)) {
          vis.push({ ...pt, px });
        }
      }

      if (vis.length === 0) return { yMin: 0, yMax: 1, visiblePoints: vis };

      let mn = Infinity;
      let mx = -Infinity;
      for (const p of vis) {
        if (p.y < mn) mn = p.y;
        if (p.y > mx) mx = p.y;
      }
      // Include threshold in range if provided
      if (thresholdY != null) {
        if (thresholdY < mn) mn = thresholdY;
        if (thresholdY > mx) mx = thresholdY;
      }
      // Ensure some range
      if (mn === mx) { mn -= 0.5; mx += 0.5; }

      return { yMin: mn, yMax: mx, visiblePoints: vis };
    }, [points, view, layout, plotWidth, thresholdY]);

    // Y coordinate mapping (top = max, bottom = min)
    const yToPixel = useCallback((y: number) => {
      const range = yMax - yMin;
      const padded = range * (1 + PLOT_TOP_PAD / PLOT_HEIGHT); // add top padding
      return ZOOM_PAD_TOP + PLOT_HEIGHT - ((y - yMin) / padded) * PLOT_HEIGHT;
    }, [yMin, yMax]);

    // Y-axis ticks
    const yTicks = useMemo(() => {
      const range = yMax - yMin;
      const rawStep = range / 4;
      const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const step = Math.ceil(rawStep / magnitude) * magnitude;
      const ticks: number[] = [];
      const start = Math.ceil(yMin / step) * step;
      for (let v = start; v <= yMax; v += step) {
        ticks.push(Math.round(v * 1000) / 1000);
      }
      return ticks;
    }, [yMin, yMax]);

    const barY = ZOOM_PAD_TOP + PLOT_HEIGHT + GAP;

    const handlePointClick = useCallback((pt: ScatterPoint) => {
      onPointSelect?.(selectedPointId === pt.id ? null : pt.id);
    }, [onPointSelect, selectedPointId]);

    const handlePointHover = useCallback((pt: ScatterPoint | null, e?: React.MouseEvent) => {
      if (!pt || !e) {
        setTooltip(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        point: pt,
      });
    }, []);

    if (containerWidth === 0) {
      return <div ref={containerRef} className={className} style={{ height: TOTAL_HEIGHT }} />;
    }

    return (
      <div ref={containerRef} className={`relative ${className ?? ""}`}>
        <svg
          ref={svgRef}
          width={containerWidth}
          height={TOTAL_HEIGHT}
          data-genome-scatter
        >
          {/* Y-axis */}
          <g transform={`translate(${Y_AXIS_WIDTH}, 0)`}>
            {/* Y-axis tick numbers and grid lines */}
            {yTicks.map((v) => {
              const py = yToPixel(v);
              if (py < ZOOM_PAD_TOP || py > ZOOM_PAD_TOP + PLOT_HEIGHT) return null;
              return (
                <g key={v}>
                  <line
                    x1={0} y1={py} x2={plotWidth} y2={py}
                    className="stroke-base-content/10"
                    strokeWidth={0.5}
                  />
                  <text
                    x={-6} y={py + 3}
                    textAnchor="end"
                    className="fill-base-content/40"
                    fontSize={9}
                  >
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Y-axis label */}
            {yLabel && (
              <text
                x={-Y_AXIS_WIDTH + 10}
                y={ZOOM_PAD_TOP + PLOT_HEIGHT / 2}
                textAnchor="middle"
                className="fill-base-content/40"
                fontSize={9}
                transform={`rotate(-90, ${-Y_AXIS_WIDTH + 10}, ${ZOOM_PAD_TOP + PLOT_HEIGHT / 2})`}
              >
                {yLabel}
              </text>
            )}
            {/* Threshold line */}
            {thresholdY != null && (
              <line
                x1={0} y1={yToPixel(thresholdY)}
                x2={plotWidth} y2={yToPixel(thresholdY)}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.6}
              />
            )}
            {/* Scatter points */}
            {visiblePoints.map((pt) => {
              const py = yToPixel(pt.y);
              const chrIdx = chromNames.indexOf(pt.chr);
              const fill = CHROM_FILLS[chrIdx % 2];
              const isSelected = selectedPointId === pt.id;
              return (
                <circle
                  key={pt.id}
                  cx={pt.px}
                  cy={py}
                  r={isSelected ? DOT_RADIUS + 1.5 : DOT_RADIUS}
                  fill={fill}
                  opacity={isSelected ? 1 : 0.7}
                  stroke={isSelected ? "#000" : "none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                  className="cursor-pointer"
                  onClick={() => handlePointClick(pt)}
                  onMouseEnter={(e) => handlePointHover(pt, e)}
                  onMouseLeave={() => handlePointHover(null)}
                />
              );
            })}
            {/* Chromosome backbone */}
            <ChromosomeTrack layout={layout} barY={barY} barHeight={BAR_HEIGHT} />
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-20 bg-base-100 border border-base-300 rounded px-2 py-1 text-xs shadow-md pointer-events-none"
            style={{
              left: Math.min(tooltip.x + 10, containerWidth - 160),
              top: tooltip.y - 40,
            }}
          >
            <div className="font-medium">{tooltip.point.label}</div>
            <div className="text-base-content/50">
              {yLabel ?? "score"}: {tooltip.point.y.toPrecision(3)}
            </div>
          </div>
        )}
      </div>
    );
  },
);
