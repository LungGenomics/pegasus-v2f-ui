// Trait detail page — genome track + loci list + per-locus evidence heatmap,
// recomposed over the redesigned relations (plan 2026-05-29). The track,
// TrackControls, and EvidenceHeatmap are the surviving old-UI components; the
// data comes from queries/explore.ts (traitLoci / locusGenes / traitSources).
//
// The viewport→list filtering (hide list rows outside the track's current
// zoom, imperative DOM toggling to avoid re-renders during pan/zoom) is ported
// from the old trait-detail page — Sam wanted it kept.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  Pencil,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ExternalLink,
} from "lucide-react";
import { useSyncSession } from "../../hooks/useSyncSession";
import { usePersistentState } from "../../hooks/usePersistentState";
import { TraitEditor } from "../../components/trait-editor/trait-editor";
import {
  getTrait,
  traitLoci,
  traitSourceTags,
  traitSources,
  traitLocusSources,
  traitEvidenceCategories,
  traitLociTopGeneByCategory,
  traitLocusCategoryCoverage,
  locusGenes,
  type LocusRow,
} from "../../data/queries/explore";
import { fetchChromSizes } from "../../data/chromSizes";
import { EVIDENCE_CATEGORIES, categoryHue } from "../../data/static";
import { GenomeTrack, type GenomeTrackHandle } from "../../components/genome-track/genome-track";
import { TrackControls } from "../../components/genome-track/track-controls";
import { EvidenceHeatmap } from "../../components/locus-detail-pane/evidence-heatmap";
import type { TrackLocus, ViewState } from "../../components/genome-track/types";
import {
  buildChromList,
  chromOffsets,
  toAbsolute,
  fromAbsolute,
} from "../../lib/genome-coords";
import { formatCoordinate, formatPvalue } from "../../lib/format";
import { STUDY_PALETTE } from "../../lib/colors";

function withChr(c: string): string {
  return c.startsWith("chr") ? c : `chr${c}`;
}

type LabelMode =
  | "cytoband"
  | "coords"
  | "nearest"
  | "top_gene"
  | "top_gene_category";

const LABEL_MODES: { value: LabelMode; label: string }[] = [
  { value: "cytoband", label: "Cytoband" },
  { value: "coords", label: "Coordinates" },
  { value: "nearest", label: "Nearest gene" },
  { value: "top_gene", label: "Top gene" },
  { value: "top_gene_category", label: "Evidence category" },
];

type SortKey = "position" | "evidence" | "genes";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "position", label: "Position" },
  { value: "evidence", label: "Evidence count" },
  { value: "genes", label: "Gene count" },
];

/** Sort the loci list. `position` keeps the query's genomic order (reversed for
 *  descending); count sorts are stable, so ties keep genomic order. Only the
 *  list order changes — the genome track positions by coordinate regardless. */
function sortLoci(loci: LocusRow[], key: SortKey, dir: SortDir): LocusRow[] {
  if (key === "position") return dir === "asc" ? loci : [...loci].reverse();
  const sign = dir === "asc" ? 1 : -1;
  const val = (l: LocusRow) =>
    key === "evidence"
      ? (l.n_gene_evidence ?? 0) // gene-level only — exclude locus-wide GWAS fan-out
      : (l.n_candidate_genes ?? 0);
  return [...loci].sort((a, b) => (val(a) - val(b)) * sign);
}

// Map the track's absolute view bounds to a single-chromosome UCSC region.
// UCSC shows one contiguous region at a time, so we take the chromosome under
// the view's center and clamp the bounds to it (the view's visible slice of
// that chromosome). Positions are 1-based for UCSC.
function viewToUcscRegion(
  view: ViewState,
  chroms: { name: string; length: number }[],
  offsets: Map<string, number>,
): { chr: string; start: number; end: number } | null {
  const center = (view.startBp + view.endBp) / 2;
  const { chr } = fromAbsolute(center, chroms, offsets);
  const offset = offsets.get(chr);
  const len = chroms.find((c) => c.name === chr)?.length;
  if (offset == null || len == null) return null;
  const start = Math.min(len, Math.max(1, Math.round(view.startBp - offset) + 1));
  const end = Math.max(1, Math.min(len, Math.round(view.endBp - offset)));
  return { chr, start, end: Math.max(start, end) };
}

function cytobandText(l: LocusRow): string {
  return l.locus_name || l.lead_rsid || l.locus_id;
}
function coordText(l: LocusRow): string {
  return formatCoordinate(l.chromosome ?? "", l.start_position ?? 0, l.end_position ?? 0);
}

/** Primary label for a locus under the given mode. Gene-based modes fall back
 *  to cytoband when no gene resolves (gene desert / no evidence in scope).
 *  `byCatGene` is the per-locus top gene for the selected category, supplied
 *  only in "top_gene_category" mode. */
function labelText(
  l: LocusRow,
  mode: LabelMode,
  byCatGene?: string | null,
): string {
  switch (mode) {
    case "coords":
      return coordText(l);
    case "nearest":
      return l.nearest_gene || cytobandText(l);
    case "top_gene":
      return l.top_gene || cytobandText(l);
    case "top_gene_category":
      return byCatGene || cytobandText(l);
    default:
      return cytobandText(l);
  }
}

/** Secondary (muted) label: the coordinate, except in coords mode where the
 *  cytoband is the more useful companion. */
function secondaryText(l: LocusRow, mode: LabelMode): string {
  return mode === "coords" ? cytobandText(l) : coordText(l);
}

/** Render `text` with the first case-insensitive occurrence of `q` emphasized.
 *  Used to bold the typed query inside a matched-gene chip. */
function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/** Genes at the locus (gene-level evidence set) that match the active filter
 *  query but aren't already the row's visible label — i.e. the reason the row
 *  matched. Empty when not filtering or the match was a non-gene field. */
function matchedGenes(
  l: LocusRow,
  query: string,
  shownLabel: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (l.evidence_genes ?? "")
    .split(" ")
    .filter(Boolean)
    .filter((g) => g.toLowerCase().includes(q) && g !== shownLabel);
}

/** Human description of what the locus label currently shows — for the row
 *  tooltip. Gene-based modes note when they fell back to cytoband (no gene). */
function labelKind(l: LocusRow, mode: LabelMode, byCatGene?: string | null): string {
  switch (mode) {
    case "coords":
      return "Coordinates";
    case "nearest":
      return l.nearest_gene ? "Nearest gene" : "Cytoband (no nearest gene)";
    case "top_gene":
      return l.top_gene ? "Top gene" : "Cytoband (no top gene)";
    case "top_gene_category":
      return byCatGene
        ? "Top gene for the selected evidence category"
        : "Cytoband (no gene for the selected category)";
    default:
      return "Cytoband";
  }
}

// Filters popover for the loci header: the evidence-only filter, sort, and the
// definition-source filter. (Label mode lives in the header — it's a display
// choice, not a filter. Track controls stay separate.)
function LociFilters({
  sortKey,
  onSortKey,
  sortDir,
  onSortDir,
  evidenceOnly,
  onEvidenceOnlyChange,
  sources,
  selectedSources,
  onSelectedSources,
}: {
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  sortDir: SortDir;
  onSortDir: (d: SortDir) => void;
  evidenceOnly: boolean;
  onEvidenceOnlyChange: (v: boolean) => void;
  sources: string[];
  selectedSources: string[];
  onSelectedSources: (s: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggleSource = (s: string) =>
    onSelectedSources(
      selectedSources.includes(s)
        ? selectedSources.filter((x) => x !== s)
        : [...selectedSources, s],
    );

  // A single source can't be filtered to anything — show it, but inert.
  const multiSource = sources.length > 1;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input input-bordered input-xs inline-flex items-center gap-1.5 w-auto text-base-content/70 hover:bg-base-200 cursor-pointer"
      >
        <SlidersHorizontal className="size-3.5" />
        Filters
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-60 border border-base-300 rounded-lg bg-base-100 shadow-lg p-3 space-y-3 text-sm">
          <label
            className="flex cursor-pointer items-center justify-between gap-2"
            title="Show only loci and genes with evidence. Within a locus, shows just genes with gene-specific evidence — hides positional candidates and genes whose only signal is locus-wide (e.g. GWAS)."
          >
            <span className="text-xs text-base-content/50">
              Genes with evidence only
            </span>
            <input
              type="checkbox"
              className="toggle toggle-xs"
              checked={evidenceOnly}
              onChange={(e) => onEvidenceOnlyChange(e.target.checked)}
            />
          </label>

          <div className="border-t border-base-200 pt-2">
            <span className="text-xs text-base-content/50">Sort by</span>
            <div className="flex items-center gap-1 mt-1">
              <select
                className="select select-bordered select-xs flex-1"
                value={sortKey}
                onChange={(e) => onSortKey(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onSortDir(sortDir === "asc" ? "desc" : "asc")}
                title={sortDir === "asc" ? "Increasing" : "Decreasing"}
                className="btn btn-xs btn-ghost px-1.5"
              >
                {sortDir === "asc" ? (
                  <ArrowUpNarrowWide className="size-3.5" />
                ) : (
                  <ArrowDownWideNarrow className="size-3.5" />
                )}
              </button>
            </div>
          </div>

          {sources.length > 0 && (
            <div className="border-t border-base-200 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-base-content/50">
                  Definition sources
                </span>
                {multiSource && selectedSources.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-base-content/40 hover:text-base-content"
                    onClick={() => onSelectedSources([])}
                  >
                    all
                  </button>
                )}
              </div>
              <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {sources.map((s) => (
                  <label
                    key={s}
                    className={`flex items-center gap-2 rounded px-1 py-0.5 ${
                      multiSource ? "cursor-pointer hover:bg-base-200/40" : "cursor-default"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={
                        selectedSources.length === 0 || selectedSources.includes(s)
                      }
                      disabled={!multiSource}
                      onChange={() => toggleSource(s)}
                    />
                    <span className="font-mono text-xs truncate">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Trait-detail content, rendered inside the Traits page for the selected
// trait. (No standalone route — Traits owns trait selection via ?trait=.)
export function TraitDetail({ traitId }: { traitId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSyncSession();
  const [editing, setEditing] = useState(false);

  const traitQ = useQuery({
    queryKey: ["explore", "trait", traitId],
    queryFn: () => getTrait(traitId),
    enabled: !!traitId,
  });
  // Definition-source filter (loci-mapping source_tags owning this trait's
  // loci). Empty = all sources. Lives in the Filters popover.
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const lociQ = useQuery({
    queryKey: ["explore", "trait-loci", traitId, selectedSources],
    queryFn: () => traitLoci(traitId, { sourceTags: selectedSources }),
    enabled: !!traitId,
  });
  const tagsQ = useQuery({
    queryKey: ["explore", "trait-tags", traitId],
    queryFn: () => traitSourceTags(traitId),
    enabled: !!traitId,
  });
  const chromQ = useQuery({
    queryKey: ["chrom-sizes", "hg38"],
    queryFn: () => fetchChromSizes("hg38"),
  });

  // Loci view prefs persist across traits (TraitDetail is keyed per-trait, so
  // these would otherwise reset on every switch) + reloads. The definition-
  // source filter stays per-trait (selectedSources) — sources differ by trait.
  const [sortKey, setSortKey] = usePersistentState<SortKey>(
    "pegasus-v2f.trait.sortKey",
    "evidence",
  );
  const [sortDir, setSortDir] = usePersistentState<SortDir>(
    "pegasus-v2f.trait.sortDir",
    "desc",
  );
  // Evidence-only view: hide loci with no non-candidate evidence (and, in the
  // heatmap, candidate-only genes). Default on — the credible-set view (all
  // positional candidates) is one toggle away. Persists across traits/reloads.
  const [evidenceOnly, setEvidenceOnly] = usePersistentState<boolean>(
    "pegasus-v2f.evidenceOnly",
    true,
  );
  const loci = useMemo(() => {
    const sorted = sortLoci(lociQ.data ?? [], sortKey, sortDir);
    return evidenceOnly
      ? sorted.filter((l) => (l.n_evidence ?? 0) > 0)
      : sorted;
  }, [lociQ.data, sortKey, sortDir, evidenceOnly]);
  const sourceTags = tagsQ.data ?? [];
  const multiSource = sourceTags.length > 1;
  const trackRef = useRef<GenomeTrackHandle>(null);

  const [locusFilter, setLocusFilter] = useState("");
  // Hovering the UCSC button glows the track to signal the view it will open.
  const [ucscHover, setUcscHover] = useState(false);
  // How loci are labeled on the track + list. cytoband (locus_name) and coords
  // are derivable from each locus's geometry; nearest/top_gene come from
  // traitLoci(); top_gene_category resolves per-locus from byCatMap below. All
  // gene modes fall back to cytoband when no gene resolves.
  const [labelMode, setLabelMode] = usePersistentState<LabelMode>(
    "pegasus-v2f.trait.labelMode",
    // Top gene where the locus has one; labelText falls back to cytoband
    // per-locus when there's no top gene (gene desert / no evidence).
    "top_gene",
  );
  // Selected category for the "By category" label mode.
  const [scoreCategory, setScoreCategory] = usePersistentState<string | null>(
    "pegasus-v2f.trait.scoreCategory",
    null,
  );

  // Categories available for the by-category picker (only fetched when needed).
  const categoriesQ = useQuery({
    queryKey: ["explore", "trait-ev-categories", traitId],
    queryFn: () => traitEvidenceCategories(traitId),
    enabled: !!traitId && labelMode === "top_gene_category",
  });
  const categories = useMemo(() => categoriesQ.data ?? [], [categoriesQ.data]);
  // Default / repair the selected category once the list loads.
  useEffect(() => {
    if (labelMode !== "top_gene_category" || categories.length === 0) return;
    if (!scoreCategory || !categories.includes(scoreCategory)) {
      setScoreCategory(categories[0]!);
    }
  }, [labelMode, categories, scoreCategory]);

  // Per-locus top gene within the selected category (by-category mode only).
  const byCatQ = useQuery({
    queryKey: ["explore", "trait-topgene-cat", traitId, scoreCategory],
    queryFn: () => traitLociTopGeneByCategory(traitId, scoreCategory!),
    enabled:
      !!traitId && labelMode === "top_gene_category" && !!scoreCategory,
  });
  const byCatMap = byCatQ.data ?? null;

  // Per-locus category coverage strip (one grouped scan; cheap). coverageMap:
  // locus_id → (category → n_genes). orderedCategories = stable column set.
  const coverageQ = useQuery({
    queryKey: ["explore", "trait-locus-coverage", traitId],
    queryFn: () => traitLocusCategoryCoverage(traitId),
    enabled: !!traitId,
  });
  const coverageMap = coverageQ.data ?? null;
  // Full fixed category set, in canonical EVIDENCE_CATEGORIES order — every
  // locus row shows the same boxes (empty where absent) so columns line up,
  // matching the locus-detail heatmap. Only hidden entirely before coverage
  // loads (so the strip doesn't flash an all-empty grid).
  const orderedCategories = useMemo(
    () => (coverageMap ? Object.keys(EVIDENCE_CATEGORIES) : []),
    [coverageMap],
  );

  const lociLabel = useCallback(
    (l: LocusRow): string =>
      labelText(l, labelMode, byCatMap?.get(l.locus_id)),
    [labelMode, byCatMap],
  );

  // Color loci by their loci-mapping source_tag when a trait spans more than
  // one (multi-source analogue of the old per-study coloring).
  const sourceColors = useMemo(() => {
    const m: Record<string, string> = {};
    sourceTags.forEach((t, i) => {
      m[t] = STUDY_PALETTE[i % STUDY_PALETTE.length]!;
    });
    return m;
  }, [sourceTags]);

  // Locus under the cursor in the list — highlights its track marker. Local
  // (not URL) state: ephemeral hover, no navigation/history.
  const [hoveredLocusId, setHoveredLocusId] = useState<string | null>(null);
  const selectedLocusId = searchParams.get("locus") ?? undefined;
  const setSelectedLocus = useCallback(
    (locusId: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (locusId) next.set("locus", locusId);
        else next.delete("locus");
        return next;
      });
    },
    [setSearchParams],
  );

  const trackLoci: TrackLocus[] = useMemo(
    () =>
      loci.map((l) => ({
        id: l.locus_id,
        chr: withChr(l.chromosome ?? ""),
        start: l.start_position ?? 0,
        end: l.end_position ?? 0,
        label: lociLabel(l),
        trait: multiSource ? (l.source_tag ?? undefined) : undefined,
        pvalue: l.lead_pvalue ?? undefined,
      })),
    [loci, multiSource, lociLabel],
  );

  // Text filter → which track triangles + list rows stay visible.
  const { filteredTrackLoci, matchingIndices } = useMemo(() => {
    if (!locusFilter.trim()) {
      return { filteredTrackLoci: trackLoci, matchingIndices: null as Set<number> | null };
    }
    const q = locusFilter.trim().toLowerCase();
    const indices = new Set<number>();
    const filtered: TrackLocus[] = [];
    loci.forEach((l, i) => {
      const tl = trackLoci[i];
      if (!tl) return;
      const hay = [
        l.locus_name,
        l.locus_id,
        l.lead_rsid,
        l.chromosome,
        l.source_tag,
        l.nearest_gene,
        l.top_gene,
        l.evidence_genes,
        byCatMap?.get(l.locus_id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) {
        filtered.push(tl);
        indices.add(i);
      }
    });
    return { filteredTrackLoci: filtered, matchingIndices: indices };
  }, [trackLoci, loci, locusFilter, byCatMap]);

  // --- Viewport → list filtering (imperative DOM, ported from old UI) ---
  const lociAbsPositions = useMemo(() => {
    if (!loci.length || !chromQ.data) return null;
    const chroms = buildChromList(chromQ.data.names, chromQ.data.lengths);
    const { offsets } = chromOffsets(chroms);
    return loci.map((l) => {
      try {
        return {
          start: toAbsolute(withChr(l.chromosome ?? ""), l.start_position ?? 0, offsets),
          end: toAbsolute(withChr(l.chromosome ?? ""), l.end_position ?? 0, offsets),
        };
      } catch {
        return null;
      }
    });
  }, [loci, chromQ.data]);

  const totalGenomeLength = useMemo(
    () => (chromQ.data ? chromQ.data.lengths.reduce((a, b) => a + b, 0) : 0),
    [chromQ.data],
  );

  const lociCountRef = useRef<HTMLSpanElement>(null);
  const lastViewRef = useRef<ViewState | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Chromosome geometry for the UCSC link (and a whole-genome fallback view).
  const chromGeom = useMemo(() => {
    if (!chromQ.data) return null;
    const chroms = buildChromList(chromQ.data.names, chromQ.data.lengths);
    return { chroms, offsets: chromOffsets(chroms).offsets };
  }, [chromQ.data]);

  // Open the current track view in the UCSC Genome Browser (hg38). UCSC is
  // one chromosome at a time, so this maps the view to the chromosome under its
  // center, clamped to the visible slice. Falls back to the full genome when no
  // view has fired yet.
  const openUcsc = useCallback(() => {
    if (!chromGeom) return;
    const view = lastViewRef.current ?? { startBp: 0, endBp: totalGenomeLength };
    const region = viewToUcscRegion(view, chromGeom.chroms, chromGeom.offsets);
    if (!region) return;
    const pos = `${region.chr}:${region.start}-${region.end}`;
    window.open(
      `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=${encodeURIComponent(pos)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [chromGeom, totalGenomeLength]);

  const applyViewFilter = useCallback(
    (view: ViewState, container: HTMLElement) => {
      if (!lociAbsPositions) return;
      const viewSpan = view.endBp - view.startBp;
      const showAll = viewSpan >= totalGenomeLength * 0.95;

      let filterStart = view.startBp;
      let filterEnd = view.endBp;
      if (!showAll) {
        const trackEl = document.querySelector<HTMLElement>("[data-genome-track]");
        const trackWidth = trackEl?.clientWidth ?? 0;
        if (trackWidth > 0) {
          const bpPerPx = viewSpan / trackWidth;
          const extraPx = (window.innerWidth - trackWidth) / 2;
          const extraBp = extraPx * bpPerPx;
          filterStart = Math.max(0, view.startBp - extraBp);
          filterEnd = view.endBp + extraBp;
        }
      }

      const buttons = container.querySelectorAll<HTMLElement>("[data-locus-idx]");
      let visible = 0;
      buttons.forEach((btn) => {
        const idx = Number(btn.dataset.locusIdx);
        const pos = lociAbsPositions[idx];
        const inView =
          showAll || (pos != null && pos.end >= filterStart && pos.start <= filterEnd);
        const matches = matchingIndices === null || matchingIndices.has(idx);
        btn.classList.toggle("hidden", !inView || !matches);
        if (inView && matches) visible++;
      });
      if (lociCountRef.current) {
        lociCountRef.current.textContent =
          visible === loci.length ? `Loci (${loci.length})` : `Loci (${visible} of ${loci.length})`;
      }
      // Show a placeholder row when the filter/view hides every locus, so the
      // list isn't just blank (imperative, like the row hiding above).
      const empty = container.querySelector<HTMLElement>("[data-empty-state]");
      if (empty) {
        empty.textContent =
          matchingIndices !== null
            ? "No loci match your filter."
            : "No loci in this view.";
        empty.classList.toggle("hidden", visible !== 0);
      }
    },
    [lociAbsPositions, totalGenomeLength, matchingIndices, loci.length],
  );

  const handleViewChange = useCallback(
    (view: ViewState) => {
      lastViewRef.current = view;
      if (listContainerRef.current) applyViewFilter(view, listContainerRef.current);
    },
    [applyViewFilter],
  );

  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      listContainerRef.current = node;
      if (node && lastViewRef.current) {
        requestAnimationFrame(() => applyViewFilter(lastViewRef.current!, node));
      }
    },
    [applyViewFilter],
  );

  // Re-apply when the text filter changes (matchingIndices identity changes).
  const prevMatching = useRef(matchingIndices);
  if (prevMatching.current !== matchingIndices) {
    prevMatching.current = matchingIndices;
    if (listContainerRef.current && lastViewRef.current) {
      requestAnimationFrame(() =>
        applyViewFilter(lastViewRef.current!, listContainerRef.current!),
      );
    }
  }

  const trait = traitQ.data;

  return (
    <div className="min-w-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{trait?.label ?? traitId}</h1>
          {trait?.description && (
            <p className="text-sm text-base-content/60 mt-1">{trait.description}</p>
          )}
          {trait?.primary_ontology_id && (
            <p className="text-xs font-mono text-base-content/40 mt-0.5">
              {trait.primary_ontology}:{trait.primary_ontology_id}
            </p>
          )}
        </div>
        {session && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit trait metadata"
            className="shrink-0 mt-0.5 p-1 rounded text-base-content/40 hover:text-base-content hover:bg-base-200 cursor-pointer"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </div>

      {editing && (
        <TraitEditor traitId={traitId} onClose={() => setEditing(false)} />
      )}

      {/* Genome track */}
      {chromQ.data && trackLoci.length > 0 && (
        <div className="mt-4 min-w-0 overflow-hidden">
          <GenomeTrack
            ref={trackRef}
            loci={filteredTrackLoci}
            highlightRegion={
              ucscHover && chromGeom && lastViewRef.current
                ? viewToUcscRegion(
                    lastViewRef.current,
                    chromGeom.chroms,
                    chromGeom.offsets,
                  )
                : null
            }
            selectedLocusId={selectedLocusId}
            hoveredLocusId={hoveredLocusId ?? undefined}
            onLocusSelect={setSelectedLocus}
            onViewChange={handleViewChange}
            chromNames={chromQ.data.names}
            chromLengths={chromQ.data.lengths}
            traitColors={multiSource ? sourceColors : undefined}
          />
        </div>
      )}

      {/* Loci header: count + filter + track controls */}
      <div className="flex flex-wrap items-center gap-2 mt-3 mb-2">
        <h3 className="text-sm font-medium text-base-content/60 shrink-0">
          <span ref={lociCountRef}>Loci ({loci.length})</span>
        </h3>
        <label className="input input-bordered input-xs flex items-center gap-1 w-44">
          <input
            type="text"
            className="grow"
            placeholder="Search loci…"
            value={locusFilter}
            onChange={(e) => setLocusFilter(e.target.value)}
          />
          {locusFilter && (
            <button
              className="text-base-content/30 hover:text-base-content"
              onClick={() => setLocusFilter("")}
            >
              <X className="size-3" />
            </button>
          )}
        </label>
        {/* Label mode is a display choice (not a filter) — surfaced in the
            header so the current label type is visible at a glance. */}
        <label className="inline-flex items-center gap-1 text-xs text-base-content/50 shrink-0">
          Label
          <select
            className="select select-bordered select-xs w-auto"
            value={labelMode}
            onChange={(e) => setLabelMode(e.target.value as LabelMode)}
            title="What each locus is labeled by in the list and track"
          >
            {LABEL_MODES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {labelMode === "top_gene_category" && (
          <select
            className="select select-bordered select-xs w-auto font-mono shrink-0"
            value={scoreCategory ?? ""}
            onChange={(e) => setScoreCategory(e.target.value || null)}
            disabled={categories.length === 0}
            title="Evidence category for the per-locus top gene"
          >
            {categories.length === 0 ? (
              <option value="">no categories</option>
            ) : (
              categories.map((c) => (
                <option key={c} value={c}>
                  {EVIDENCE_CATEGORIES[c] ?? c}
                </option>
              ))
            )}
          </select>
        )}
        <LociFilters
          sortKey={sortKey}
          onSortKey={setSortKey}
          sortDir={sortDir}
          onSortDir={setSortDir}
          evidenceOnly={evidenceOnly}
          onEvidenceOnlyChange={setEvidenceOnly}
          sources={sourceTags}
          selectedSources={selectedSources}
          onSelectedSources={setSelectedSources}
        />
        {chromQ.data && (
          <div className="ml-auto flex items-center gap-2">
            {trackLoci.length > 0 && (
              <button
                type="button"
                onClick={openUcsc}
                onMouseEnter={() => setUcscHover(true)}
                onMouseLeave={() => setUcscHover(false)}
                title="Open the current view in the UCSC Genome Browser (hg38). UCSC shows one chromosome at a time — the chromosome under the view opens."
                className="input input-bordered input-xs inline-flex items-center gap-1.5 w-auto text-base-content/70 hover:bg-base-200 cursor-pointer"
              >
                <ExternalLink className="size-3.5" />
                UCSC
              </button>
            )}
            <TrackControls
              chromNames={chromQ.data.names}
              onChromSelect={(chr) => trackRef.current?.zoomToChrom(chr)}
              onRegionInput={(chr, s, e) => trackRef.current?.zoomToRegion(chr, s, e)}
              onZoomIn={() => trackRef.current?.zoomIn()}
              onZoomOut={() => trackRef.current?.zoomOut()}
              onReset={() => trackRef.current?.fullReset()}
              onPrevLocus={() => trackRef.current?.navigateLocus(-1)}
              onNextLocus={() => trackRef.current?.navigateLocus(1)}
              hasLoci={trackRef.current?.hasLoci ?? false}
            />
          </div>
        )}
      </div>

      {/* Loci list / selected-locus detail */}
      <LociPane
        loci={loci}
        loading={lociQ.isLoading}
        evidenceOnly={evidenceOnly}
        traitId={traitId}
        listRef={listRef}
        selectedLocusId={selectedLocusId}
        onSelect={setSelectedLocus}
        onHoverLocus={setHoveredLocusId}
        filterQuery={locusFilter.trim()}
        sourceColors={multiSource ? sourceColors : undefined}
        labelMode={labelMode}
        byCatMap={byCatMap}
        coverageMap={coverageMap}
        orderedCategories={orderedCategories}
      />

      <TraitLocusSourcesPanel traitId={traitId} />
      <TraitSourcesPanel traitId={traitId} />
    </div>
  );
}

// --- Loci list + selected locus heatmap ---

// Per-locus category-coverage strip: one cell per evidence category (fixed
// column order across rows), opacity = fraction of the locus's candidate genes
// that carry that category. A compact "what implicates this locus" indicator.
function CoverageStrip({
  locusId,
  nCandidateGenes,
  coverageMap,
  categories,
}: {
  locusId: string;
  nCandidateGenes: number;
  coverageMap: Map<string, Map<string, number>> | null;
  categories: string[];
}) {
  const byCat = coverageMap?.get(locusId);
  const denom = nCandidateGenes > 0 ? nCandidateGenes : 1;
  return (
    <span className="hidden md:flex items-center gap-0.75 shrink-0">
      {categories.map((cat) => {
        const n = byCat?.get(cat) ?? 0;
        const cov = Math.min(1, n / denom);
        const has = cov > 0;
        const hue = categoryHue(cat);
        // Match the locus-detail heatmap cells: small rounded box, filled by
        // coverage when present; empty boxes are dashed base-300 like the
        // heatmap's no-evidence cells.
        return (
          <span
            key={cat}
            className="w-2.75 h-2.75 rounded-[2px] shrink-0"
            title={`${cat}: ${n}/${nCandidateGenes} genes (${Math.round(cov * 100)}%)`}
            style={{
              backgroundColor: has
                ? `hsl(${hue} 70% 50% / ${Math.min(1, 0.25 + cov * 0.75)})`
                : "transparent",
              border: has ? "none" : "1px dashed var(--color-base-300)",
            }}
          />
        );
      })}
    </span>
  );
}

function LociPane({
  loci,
  loading,
  evidenceOnly,
  traitId,
  listRef,
  selectedLocusId,
  onSelect,
  onHoverLocus,
  filterQuery,
  sourceColors,
  labelMode,
  byCatMap,
  coverageMap,
  orderedCategories,
}: {
  loci: LocusRow[];
  loading: boolean;
  evidenceOnly: boolean;
  traitId: string;
  listRef: React.Ref<HTMLDivElement>;
  selectedLocusId?: string;
  onSelect: (id: string | null) => void;
  onHoverLocus: (id: string | null) => void;
  filterQuery: string;
  sourceColors?: Record<string, string>;
  labelMode: LabelMode;
  byCatMap: Map<string, string> | null;
  coverageMap: Map<string, Map<string, number>> | null;
  orderedCategories: string[];
}) {
  const selected = selectedLocusId
    ? loci.find((l) => l.locus_id === selectedLocusId)
    : undefined;

  if (loci.length === 0) {
    return (
      <div className="border border-base-300 rounded-lg px-3 py-4 text-sm text-base-content/40 text-center">
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="loading loading-spinner loading-xs" />
            Loading loci…
          </span>
        ) : (
          "No loci for this trait."
        )}
      </div>
    );
  }

  if (selected) {
    return (
      <div className="border border-base-300 rounded-lg overflow-hidden">
        <button
          className="w-full px-3 py-1.5 text-xs text-base-content/50 hover:text-base-content hover:bg-base-200/50 text-left border-b border-base-300"
          onClick={() => onSelect(null)}
        >
          ← Back to list
        </button>
        <LocusDetail
          locus={selected}
          traitId={traitId}
          evidenceOnly={evidenceOnly}
        />
      </div>
    );
  }

  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      <div ref={listRef} className="overflow-y-auto max-h-[calc(100vh-19.5rem)]">
      {loci.map((l, i) => (
        <button
          key={l.locus_id}
          data-locus-idx={i}
          className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-base-300 -mt-px first:border-t-0 first:mt-0 hover:bg-base-200/50"
          onClick={() => onSelect(l.locus_id)}
          onMouseEnter={() => onHoverLocus(l.locus_id)}
          onMouseLeave={() => onHoverLocus(null)}
        >
          {sourceColors?.[l.source_tag ?? ""] && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: sourceColors[l.source_tag ?? ""] }}
            />
          )}
          {/* Label + coords absorb all variable width and truncate, so the
              coverage strip + gene count keep a fixed column on every row. */}
          <span className="flex items-baseline gap-2 min-w-0 flex-1">
            <span
              className="text-sm font-medium font-mono min-w-0 truncate"
              title={labelKind(l, labelMode, byCatMap?.get(l.locus_id))}
            >
              {labelText(l, labelMode, byCatMap?.get(l.locus_id))}
            </span>
            {/* While filtering, show why this row matched if it was a gene other
                than the label — a small chip next to the top gene. */}
            {filterQuery &&
              (() => {
                const m = matchedGenes(
                  l,
                  filterQuery,
                  labelText(l, labelMode, byCatMap?.get(l.locus_id)),
                );
                if (m.length === 0) return null;
                return (
                  <span className="shrink-0 inline-flex items-center gap-1">
                    {m.slice(0, 3).map((g) => (
                      <span
                        key={g}
                        className="rounded border border-primary/30 bg-primary/10 px-1 font-mono text-[10px] leading-tight text-primary/80"
                      >
                        {highlightMatch(g, filterQuery)}
                      </span>
                    ))}
                    {m.length > 3 && (
                      <span className="text-[10px] text-base-content/40">
                        +{m.length - 3}
                      </span>
                    )}
                  </span>
                );
              })()}
            <span className="text-xs text-base-content/40 hidden sm:inline truncate">
              {secondaryText(l, labelMode)}
            </span>
          </span>
          {orderedCategories.length > 0 && (
            <CoverageStrip
              locusId={l.locus_id}
              nCandidateGenes={l.n_candidate_genes ?? 0}
              coverageMap={coverageMap}
              categories={orderedCategories}
            />
          )}
          {(() => {
            const n = (evidenceOnly ? l.n_evidence_genes : l.n_candidate_genes) ?? 0;
            const genes = (l.evidence_genes ?? "").split(" ").filter(Boolean);
            const list =
              genes.slice(0, 20).join(", ") + (genes.length > 20 ? ", …" : "");
            const title = genes.length
              ? `Genes with evidence: ${list}`
              : evidenceOnly
                ? "Genes with evidence"
                : "Candidate genes";
            return (
              <span
                className="text-xs text-base-content/40 tabular-nums shrink-0 w-16 text-right"
                title={title}
              >
                {n} gene{n === 1 ? "" : "s"}
              </span>
            );
          })()}
        </button>
      ))}
      {/* Shown imperatively by applyViewFilter when filter/view hides all loci. */}
      <div
        data-empty-state
        className="hidden px-3 py-2 text-sm text-base-content/40"
      />
      </div>
    </div>
  );
}

function LocusDetail({
  locus,
  evidenceOnly,
}: {
  locus: LocusRow;
  traitId: string;
  evidenceOnly: boolean;
}) {
  // Same-trait evidence only (the locus's own). Cross-trait/pleiotropy is a
  // deferred page-level feature, not a per-locus toggle.
  const genesQ = useQuery({
    queryKey: ["explore", "locus-genes", locus.locus_id],
    queryFn: () => locusGenes(locus.locus_id),
  });

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <h4 className="text-sm font-medium text-base-content/70 font-mono min-w-0 truncate">
          {locus.locus_name || locus.locus_id}
        </h4>
        <Link
          to={`/locus/${encodeURIComponent(locus.locus_id)}`}
          title="Open the full locus page"
          className="text-base-content/40 hover:text-primary shrink-0"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mb-3">
        <span>
          {formatCoordinate(
            locus.chromosome ?? "",
            locus.start_position ?? 0,
            locus.end_position ?? 0,
          )}
        </span>
        {locus.lead_rsid && <span>Lead: {locus.lead_rsid}</span>}
        {locus.lead_pvalue != null && <span>P: {formatPvalue(locus.lead_pvalue)}</span>}
        <span>
          {locus.n_candidate_genes ?? 0} candidate gene
          {locus.n_candidate_genes === 1 ? "" : "s"}
        </span>
      </div>
      {genesQ.isLoading ? (
        <p className="text-sm text-base-content/40">Loading…</p>
      ) : (
        <EvidenceHeatmap
          genes={genesQ.data ?? []}
          categories={EVIDENCE_CATEGORIES}
          evidenceOnly={evidenceOnly}
        />
      )}
    </div>
  );
}

// --- Locus sources (loci-definition sources owning this trait's loci) ---

function TraitLocusSourcesPanel({ traitId }: { traitId: string }) {
  const q = useQuery({
    queryKey: ["explore", "trait-locus-sources", traitId],
    queryFn: () => traitLocusSources(traitId),
    enabled: !!traitId,
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="mt-8">
      <h3
        className="text-sm font-medium text-base-content/60 mb-2"
        title="GWAS sources whose sentinels defined this trait's loci (the windows)."
      >
        Locus sources ({rows.length})
      </h3>
      <div className="border border-base-300 rounded-lg overflow-hidden">
        {rows.map((r, i) => (
          <Link
            key={r.source_tag}
            to={`/sources?source=${encodeURIComponent(r.source_tag)}`}
            className={`flex items-center gap-3 px-4 py-2 hover:bg-base-200/50 ${
              i > 0 ? "border-t border-base-300" : ""
            }`}
          >
            <span className="font-mono text-sm text-primary truncate flex-1">
              {r.source_tag}
            </span>
            <span className="text-xs text-base-content/50 tabular-nums shrink-0 w-24 text-right">
              {r.n_loci.toLocaleString()} loci
            </span>
            <span className="text-xs text-base-content/40 tabular-nums shrink-0 w-28 text-right">
              {r.n_sentinels.toLocaleString()} sentinels
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// --- Evidence sources (sources contributing evidence at this trait's loci) ---

function TraitSourcesPanel({ traitId }: { traitId: string }) {
  const q = useQuery({
    queryKey: ["explore", "trait-sources", traitId],
    queryFn: () => traitSources(traitId),
    enabled: !!traitId,
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="mt-8">
      <h3
        className="text-sm font-medium text-base-content/60 mb-2"
        title="Sources contributing evidence (any category) at this trait's loci."
      >
        Evidence sources ({rows.length})
      </h3>
      <div className="border border-base-300 rounded-lg overflow-hidden">
        {rows.map((r, i) => (
          <Link
            key={r.source_tag}
            to={`/sources?source=${encodeURIComponent(r.source_tag)}`}
            className={`flex items-center gap-3 px-4 py-2 hover:bg-base-200/50 ${
              i > 0 ? "border-t border-base-300" : ""
            }`}
          >
            <span className="font-mono text-sm text-primary truncate flex-1">
              {r.source_tag}
            </span>
            <div className="flex flex-wrap gap-1 shrink-0">
              {r.categories.map((c) => (
                <span key={c} className="badge badge-xs badge-outline text-[10px]">
                  {c}
                </span>
              ))}
            </div>
            <span className="text-xs text-base-content/50 tabular-nums shrink-0 w-24 text-right">
              {r.n_evidence.toLocaleString()} rows
            </span>
            <span className="text-xs text-base-content/40 tabular-nums shrink-0 w-20 text-right">
              {r.n_genes} genes
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
