import { useRef, useState, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import type { TrackLocus, TrackItem, ViewState } from "./types";
import { isCluster } from "./types";
import { useTrackLayout } from "./use-track-layout";
import { useGenomeZoom } from "./use-genome-zoom";
import { ChromosomeTrack } from "./chromosome-track";
import { LocusMarkers } from "./locus-markers";
import {
  buildChromList,
  chromOffsets,
  clusterLoci,
  sortLociByPosition,
  toAbsolute,
} from "../../lib/genome-coords";

// Layout constants
const LABEL_AREA = 16;
const MARKER_AREA = 6;
const GAP = 2; // space between triangles and bar
const BAR_Y = LABEL_AREA + MARKER_AREA + GAP; // 24
const BAR_HEIGHT = 4;
const CHR_LABEL_AREA = 12; // space for chr labels below bar
const ZOOM_PAD_TOP = 80; // extra interactive area above content for easier pan/zoom
const CONTENT_HEIGHT = BAR_Y + BAR_HEIGHT + CHR_LABEL_AREA; // 40
const TOTAL_HEIGHT = ZOOM_PAD_TOP + CONTENT_HEIGHT;
const MIN_PIXEL_GAP = 8;

export type GenomeTrackHandle = {
  zoomToChrom: (chr: string) => void;
  zoomToRegion: (chr: string, start: number, end: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fullReset: () => void;
  navigateLocus: (dir: 1 | -1) => void;
  hasLoci: boolean;
};

export type GenomeTrackProps = {
  loci: TrackLocus[];
  selectedLocusId?: string;
  onLocusSelect: (id: string | null) => void;
  onViewChange?: (view: ViewState) => void;
  chromNames: string[];
  chromLengths: number[];
  traitColors?: Record<string, string>;
  className?: string;
};

export const GenomeTrack = forwardRef<GenomeTrackHandle, GenomeTrackProps>(function GenomeTrack({
  loci,
  selectedLocusId,
  onLocusSelect,
  onViewChange: onViewChangeProp,
  chromNames,
  chromLengths,
  traitColors,
  className,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [view, setView] = useState<ViewState>({ startBp: 0, endBp: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Observe container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useTrackLayout(containerWidth, view, chromNames, chromLengths);

  const onViewChange = useCallback(
    (v: ViewState) => {
      setView(v);
      onViewChangeProp?.(v);
    },
    [onViewChangeProp],
  );

  const { zoomTo, resetZoom, zoomIn, zoomOut } = useGenomeZoom(svgRef, {
    totalLength: layout.totalLength,
    containerWidth,
    onViewChange,
  });

  // Memoize sorted loci and clusters
  const sortedLoci = useMemo(
    () => sortLociByPosition(loci, layout.offsets),
    [loci, layout.offsets],
  );
  const trackItems = useMemo(
    () => clusterLoci(sortedLoci, layout.bpToPixel, MIN_PIXEL_GAP),
    [sortedLoci, layout.bpToPixel],
  );

  // Stable offsets for zoom calculations — computed from props, not from
  // view-dependent layout (avoids feedback loops during zoom animations)
  const stableOffsets = useMemo(() => {
    const chroms = buildChromList(chromNames, chromLengths);
    return chromOffsets(chroms).offsets;
  }, [chromNames, chromLengths]);

  // Zoom to center a locus with padding
  const zoomToLocus = useCallback(
    (locus: TrackLocus) => {
      try {
        const start = toAbsolute(locus.chr, locus.start, stableOffsets);
        const end = toAbsolute(locus.chr, locus.end, stableOffsets);
        const span = Math.max(end - start, 5_000_000);
        const mid = (start + end) / 2;
        zoomTo(mid - span * 3, mid + span * 3);
      } catch {
        // chromosome not in offsets — skip zoom
      }
    },
    [stableOffsets, zoomTo],
  );

  // Navigate to prev/next locus
  const navigateLocus = useCallback(
    (direction: 1 | -1) => {
      if (sortedLoci.length === 0) return;
      const currentIdx = selectedLocusId
        ? sortedLoci.findIndex((l) => l.id === selectedLocusId)
        : -1;
      let nextIdx: number;
      if (direction === 1) {
        nextIdx = currentIdx < sortedLoci.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : sortedLoci.length - 1;
      }
      const next = sortedLoci[nextIdx]!;
      onLocusSelect(next.id);
      zoomToLocus(next);
    },
    [sortedLoci, selectedLocusId, onLocusSelect, zoomToLocus],
  );

  // Zoom to a chromosome (empty string = reset to all)
  const zoomToChrom = useCallback(
    (chr: string) => {
      if (!chr) {
        resetZoom();
        return;
      }
      const offset = stableOffsets.get(chr);
      const chroms = buildChromList(chromNames, chromLengths);
      const chrInfo = chroms.find((c) => c.name === chr);
      if (offset === undefined || !chrInfo) return;
      zoomTo(offset, offset + chrInfo.length);
    },
    [stableOffsets, chromNames, chromLengths, zoomTo, resetZoom],
  );

  // Zoom to a region
  const zoomToRegion = useCallback(
    (chr: string, start: number, end: number) => {
      try {
        const absStart = toAbsolute(chr, start, stableOffsets);
        const absEnd = toAbsolute(chr, end, stableOffsets);
        zoomTo(absStart, absEnd);
      } catch {
        // unknown chromosome
      }
    },
    [stableOffsets, zoomTo],
  );

  // Find the nearest track item at a given pixel (x, y). Returns null if nothing within range.
  const hitTest = useCallback(
    (px: number, py: number): { item: TrackItem; dist: number } | null => {
      // Only match in the vertical zone of triangles + labels (above the bar)
      // Content is offset by ZOOM_PAD_TOP within the SVG
      const contentY = py - ZOOM_PAD_TOP;
      if (contentY < 0 || contentY > BAR_Y) return null;
      let best: { item: TrackItem; dist: number } | null = null;
      const hitRadius = 5;
      for (const item of trackItems) {
        let dist: number;
        if (isCluster(item)) {
          dist = Math.abs(px - item.centerPixel);
        } else {
          const locus = item as TrackLocus;
          const midPx = layout.bpToPixel(
            locus.chr,
            (locus.start + locus.end) / 2,
          );
          dist = Math.abs(px - midPx);
        }
        if (dist < hitRadius && (!best || dist < best.dist)) {
          best = { item, dist };
        }
      }
      return best;
    },
    [trackItems, layout],
  );

  // Click: select single locus, zoom into cluster
  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) return;

      if (isCluster(hit.item)) {
        // Zoom into the cluster region with padding
        const cluster = hit.item;
        try {
          const absStart = toAbsolute(
            cluster.loci[0]!.chr,
            cluster.loci[0]!.start,
            stableOffsets,
          );
          const absEnd = toAbsolute(
            cluster.loci[cluster.loci.length - 1]!.chr,
            cluster.loci[cluster.loci.length - 1]!.end,
            stableOffsets,
          );
          const span = Math.max(absEnd - absStart, 5_000_000);
          const mid = (absStart + absEnd) / 2;
          zoomTo(mid - span * 2, mid + span * 2);
        } catch {
          // unknown chromosome
        }
      } else {
        onLocusSelect((hit.item as TrackLocus).id);
      }
    },
    [hitTest, onLocusSelect, stableOffsets, zoomTo],
  );

  // Hover: show pointer cursor when over a clickable item
  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      svg.style.cursor = hit ? "pointer" : "grab";
    },
    [hitTest],
  );

  // Auto-zoom to selected locus (deselect does NOT change zoom)
  const zoomedToSelection = useRef<string | null>(null);
  const zoomedWithWidth = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedLocusId) {
      zoomedToSelection.current = null;
      zoomedWithWidth.current = null;
      return;
    }
    if (
      zoomedToSelection.current === selectedLocusId &&
      zoomedWithWidth.current === containerWidth
    ) return;
    const locus = sortedLoci.find((l) => l.id === selectedLocusId);
    if (locus) {
      zoomToLocus(locus);
      zoomedToSelection.current = selectedLocusId;
      zoomedWithWidth.current = containerWidth;
    }
  }, [selectedLocusId, sortedLoci, containerWidth]);

  // Full reset: clear selection + zoom to full genome
  const fullReset = useCallback(() => {
    zoomedToSelection.current = null;
    zoomedWithWidth.current = null;
    onLocusSelect(null);
    resetZoom();
  }, [onLocusSelect, resetZoom]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateLocus(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateLocus(1);
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "Escape") {
        fullReset();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateLocus, zoomIn, zoomOut, fullReset]);

  useImperativeHandle(ref, () => ({
    zoomToChrom,
    zoomToRegion,
    zoomIn,
    zoomOut,
    fullReset,
    navigateLocus,
    hasLoci: sortedLoci.length > 0,
  }), [zoomToChrom, zoomToRegion, zoomIn, zoomOut, fullReset, navigateLocus, sortedLoci.length]);

  return (
    <div ref={containerRef} data-genome-track className={className}>
      <svg
        ref={svgRef}
        width={containerWidth}
        height={TOTAL_HEIGHT}
        className="select-none overflow-visible"
        onClick={handleSvgClick}
        onMouseMove={handleSvgMouseMove}
      >
        <g pointerEvents="none" transform={`translate(0,${ZOOM_PAD_TOP})`}>
          <ChromosomeTrack
            layout={layout}
            barY={BAR_Y}
            barHeight={BAR_HEIGHT}
          />
          <LocusMarkers
            items={trackItems}
            layout={layout}
            barY={BAR_Y}
            selectedLocusId={selectedLocusId}
            traitColors={traitColors}
          />
        </g>
        <rect
          width={containerWidth}
          height={TOTAL_HEIGHT}
          fill="transparent"
        />
      </svg>
    </div>
  );
});
