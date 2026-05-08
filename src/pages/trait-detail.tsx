import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { ChevronDown, X } from "lucide-react";
import { useTraitLoci } from "../api/traits";
import { useChromSizes, useEvidenceCategories } from "../api/db";
import { PageHeader } from "../components/layout/page-header";
import { Loading, ErrorAlert } from "../components/loading";
import { GenomeTrack, type GenomeTrackHandle } from "../components/genome-track/genome-track";
import { TrackControls } from "../components/genome-track/track-controls";
import { EvidenceHeatmap } from "../components/locus-detail-pane/evidence-heatmap";
import { useLocusGenes } from "../api/studies";
import { formatCoordinate, formatPvalue } from "../lib/format";
import type { TrackLocus, ViewState } from "../components/genome-track/types";
import type { Locus, Study } from "../api/types";
import { buildChromList, chromOffsets, toAbsolute } from "../lib/genome-coords";
import { STUDY_PALETTE } from "../lib/colors";

export function TraitDetailPage() {
  const { trait: rawTrait } = useParams<{ trait: string }>();
  const trait = rawTrait ? decodeURIComponent(rawTrait) : "";
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: loci, isLoading, error, studies } = useTraitLoci(trait);
  const chromQ = useChromSizes();
  const trackRef = useRef<GenomeTrackHandle>(null);

  const multiStudy = studies.length > 1;
  const [labelByGene, setLabelByGene] = useState(false);
  const [locusFilter, setLocusFilter] = useState("");

  const studyColors = useMemo(() => {
    const colors: Record<string, string> = {};
    studies.forEach((s, i) => {
      colors[s.study_id] = STUDY_PALETTE[i % STUDY_PALETTE.length]!;
    });
    return colors;
  }, [studies]);

  // Loci count per study
  const studyLociCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of loci ?? []) {
      const sid = l.study_id ?? "";
      counts[sid] = (counts[sid] ?? 0) + 1;
    }
    return counts;
  }, [loci]);

  const selectedLocusId = searchParams.get("locus") ?? undefined;

  const setSelectedLocus = useCallback(
    (id: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id) {
          next.set("locus", id);
        } else {
          next.delete("locus");
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const trackLoci: TrackLocus[] = useMemo(() => {
    if (!loci) return [];
    return loci.map((l) => ({
      id: l.locus_id,
      chr: l.chromosome.startsWith("chr")
        ? l.chromosome
        : `chr${l.chromosome}`,
      start: l.start_position,
      end: l.end_position,
      label: labelByGene && l.nearest_gene && l.nearest_gene !== "-"
        ? l.nearest_gene
        : l.locus_name || l.lead_rsid || l.locus_id,
      trait: multiStudy ? l.study_id : undefined,
      pvalue:
        typeof l.lead_pvalue === "number"
          ? l.lead_pvalue
          : parseFloat(String(l.lead_pvalue)) || undefined,
    }));
  }, [loci, multiStudy, labelByGene]);

  // --- Search filter: hides triangles + list items without changing zoom ---

  const { filteredTrackLoci, matchingIndices } = useMemo(() => {
    if (!locusFilter.trim()) {
      return { filteredTrackLoci: trackLoci, matchingIndices: null };
    }
    const q = locusFilter.trim().toLowerCase();
    const indices = new Set<number>();
    const filtered: TrackLocus[] = [];
    for (let i = 0; i < (loci ?? []).length; i++) {
      const l = loci![i]!;
      const tl = trackLoci[i];
      if (!tl) continue;
      const haystack = [
        l.locus_name, l.locus_id, l.lead_rsid, l.nearest_gene,
        l.chromosome, tl.label,
      ].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(q)) {
        filtered.push(tl);
        indices.add(i);
      }
    }
    return { filteredTrackLoci: filtered, matchingIndices: indices };
  }, [trackLoci, loci, locusFilter]);

  // --- List filtering from genome track viewport ---
  // Imperative DOM toggling — bypasses React re-renders during zoom

  const lociAbsPositions = useMemo(() => {
    if (!loci || !chromQ.data) return null;
    const chroms = buildChromList(chromQ.data.names, chromQ.data.lengths);
    const { offsets } = chromOffsets(chroms);
    return loci.map((l) => {
      const chr = l.chromosome.startsWith("chr")
        ? l.chromosome
        : `chr${l.chromosome}`;
      try {
        return {
          start: toAbsolute(chr, l.start_position, offsets),
          end: toAbsolute(chr, l.end_position, offsets),
        };
      } catch {
        return null;
      }
    });
  }, [loci, chromQ.data]);

  const totalGenomeLength = useMemo(() => {
    if (!chromQ.data) return 0;
    return chromQ.data.lengths.reduce((a, b) => a + b, 0);
  }, [chromQ.data]);

  const lociCountRef = useRef<HTMLSpanElement>(null);
  const lastViewRef = useRef<ViewState | null>(null);

  const applyViewFilter = useCallback(
    (view: ViewState, container: HTMLElement) => {
      if (!loci || !lociAbsPositions) return;

      const viewSpan = view.endBp - view.startBp;
      const showAll = viewSpan >= totalGenomeLength * 0.95;

      // Expand filter range to include loci visible in viewport overflow
      // (track SVG overflows the container into the page padding/margins)
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
      let visibleCount = 0;

      buttons.forEach((btn) => {
        const idx = Number(btn.dataset.locusIdx);
        const pos = lociAbsPositions[idx];
        const inViewport =
          showAll || (pos != null && pos.end >= filterStart && pos.start <= filterEnd);
        const matchesFilter = matchingIndices === null || matchingIndices.has(idx);
        btn.classList.toggle("hidden", !inViewport || !matchesFilter);
        if (inViewport && matchesFilter) visibleCount++;
      });

      if (lociCountRef.current) {
        const total = loci.length;
        lociCountRef.current.textContent =
          visibleCount === total
            ? `Loci (${total})`
            : `Loci (${visibleCount} of ${total})`;
      }
    },
    [loci, lociAbsPositions, totalGenomeLength, matchingIndices],
  );

  const handleViewChange = useCallback(
    (view: ViewState) => {
      lastViewRef.current = view;
      const container = document.querySelector<HTMLElement>("[data-locus-list]");
      if (container) applyViewFilter(view, container);
    },
    [applyViewFilter],
  );

  // Re-apply filter when list remounts or search changes
  const locusListRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && lastViewRef.current) {
        requestAnimationFrame(() => applyViewFilter(lastViewRef.current!, node));
      }
    },
    [applyViewFilter],
  );

  // Re-apply viewport+search filter when search term changes
  const locusListContainerRef = useRef<HTMLDivElement | null>(null);
  const combinedListRef = useCallback(
    (node: HTMLDivElement | null) => {
      locusListContainerRef.current = node;
      locusListRef(node);
    },
    [locusListRef],
  );

  // When matchingIndices changes (search typed), re-filter the existing list
  const prevMatchingRef = useRef(matchingIndices);
  if (prevMatchingRef.current !== matchingIndices) {
    prevMatchingRef.current = matchingIndices;
    if (locusListContainerRef.current && lastViewRef.current) {
      requestAnimationFrame(() =>
        applyViewFilter(lastViewRef.current!, locusListContainerRef.current!),
      );
    }
  }


  if (isLoading) return <Loading />;
  if (error) return <ErrorAlert message={error.message} />;
  if (!studies.length) return null;

  const primaryStudy = studies[0]!;

  return (
    <div>
      <PageHeader
        title={trait}
        description={primaryStudy.trait_description}
        breadcrumbs={[
          { label: "Traits", to: "/" },
          { label: trait },
        ]}
      />

      {/* Study accordion */}
      <h3 className="text-sm font-medium text-base-content/60 mb-3">
        Studies ({studies.length})
      </h3>
      <StudyAccordionList
        studies={studies}
        studyColors={studyColors}
        studyLociCounts={studyLociCounts}
        multiStudy={multiStudy}
      />

      {/* Genome track */}
      {chromQ.data && (
        <GenomeTrack
          ref={trackRef}
          loci={filteredTrackLoci}
          selectedLocusId={selectedLocusId}
          onLocusSelect={setSelectedLocus}
          onViewChange={handleViewChange}
          chromNames={chromQ.data.names}
          chromLengths={chromQ.data.lengths}
          traitColors={multiStudy ? studyColors : undefined}
        />
      )}
      {chromQ.isLoading && (
        <div className="h-16 flex items-center justify-center text-base-content/40">
          Loading genome track...
        </div>
      )}

      {/* Loci header: title + filter + track controls — single row */}
      <div className="flex items-center gap-3 mt-2 mb-2">
        <h3 className="text-sm font-medium text-base-content/60 shrink-0">
          <span ref={lociCountRef}>Loci ({loci?.length ?? 0})</span>
        </h3>
        <label className="input input-bordered input-xs flex items-center gap-1 w-40">
          <input
            type="text"
            className="grow"
            placeholder="Filter..."
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
        <label className="flex items-center gap-1.5 text-xs text-base-content/50 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={labelByGene}
            onChange={(e) => setLabelByGene(e.target.checked)}
          />
          Label by gene
        </label>
        {chromQ.data && (
          <div className="ml-auto">
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

      {/* Loci list */}
      <div>
        <LocusList
          loci={loci ?? []}
          listRef={combinedListRef}
          selectedLocusId={selectedLocusId}
          onSelectLocus={setSelectedLocus}
          studyColors={multiStudy ? studyColors : undefined}
          studies={multiStudy ? studies : undefined}
          labelByGene={labelByGene}
        />
      </div>
    </div>
  );
}

// --- Study accordion item ---

function StudyAccordionItem({
  study,
  color,
  lociCount,
  showColor,
}: {
  study: Study;
  color?: string;
  lociCount: number;
  showColor: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-base-300 last:border-b-0">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {showColor && color && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {study.gwas_source || study.study_id}
        </span>
        <span className="text-xs text-base-content/40 tabular-nums">
          {lociCount} loci
        </span>
        <ChevronDown
          className={`size-3.5 text-base-content/40 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mb-2">
            {study.ancestry && <span>Ancestry: {study.ancestry}</span>}
            {study.sample_size && study.sample_size !== "-" && (
              <span>N = {study.sample_size}</span>
            )}
            {study.doi && <span>DOI: {study.doi}</span>}
            {study.year && study.year !== "-" && <span>Year: {study.year}</span>}
          </div>
          {/* Export buttons removed — pending client-side Blob generators. */}
        </div>
      )}
    </div>
  );
}

// --- Study accordion list (capped at 5, expandable) ---

const STUDY_CAP = 5;

function StudyAccordionList({
  studies,
  studyColors,
  studyLociCounts,
  multiStudy,
}: {
  studies: Study[];
  studyColors: Record<string, string>;
  studyLociCounts: Record<string, number>;
  multiStudy: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped = !showAll && studies.length > STUDY_CAP;
  const visible = capped ? studies.slice(0, STUDY_CAP) : studies;

  return (
    <div className="bg-base-100 border border-base-300 rounded-lg mb-4">
      {visible.map((s) => (
        <StudyAccordionItem
          key={s.study_id}
          study={s}
          color={studyColors[s.study_id]}
          lociCount={studyLociCounts[s.study_id] ?? 0}
          showColor={multiStudy}
        />
      ))}
      {capped && (
        <button
          className="w-full px-3 py-2 text-xs text-base-content/50 hover:text-base-content hover:bg-base-200/50 transition-colors border-t border-base-300"
          onClick={() => setShowAll(true)}
        >
          Show all {studies.length} studies
        </button>
      )}
    </div>
  );
}

// --- Locus accordion list (full length, flows in page) ---

function LocusList({
  loci,
  listRef,
  selectedLocusId,
  onSelectLocus,
  studyColors,
  studies,
  labelByGene,
}: {
  loci: Locus[];
  listRef: React.Ref<HTMLDivElement>;
  selectedLocusId?: string;
  onSelectLocus: (id: string | null) => void;
  studyColors?: Record<string, string>;
  studies?: Study[];
  labelByGene?: boolean;
}) {
  const selectedLocus = selectedLocusId
    ? loci.find((l) => l.locus_id === selectedLocusId)
    : undefined;

  if (loci.length === 0) {
    return (
      <div className="bg-base-100 border border-base-300 rounded-lg px-3 py-4 text-sm text-base-content/40 text-center">
        No loci
      </div>
    );
  }

  if (selectedLocus) {
    return (
      <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
        <button
          className="w-full px-3 py-1.5 text-xs text-base-content/50 hover:text-base-content hover:bg-base-200/50 transition-colors text-left border-b border-base-300"
          onClick={() => onSelectLocus(null)}
        >
          ← Back to list
        </button>
        <LocusDetail locus={selectedLocus} studyColor={studyColors?.[selectedLocus.study_id ?? ""]} studyLabel={studies?.find((s) => s.study_id === selectedLocus.study_id)?.gwas_source} />
      </div>
    );
  }

  // Map chromosome to its genome-wide index for coloring
  // Matches the genome track's alternating slate-300/slate-400 scheme
  return (
    <div ref={listRef} data-locus-list className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
      {loci.map((l, i) => {
        return (
        <button
          key={l.locus_id}
          data-locus-idx={i}
          className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-base-300 -mt-px hover:bg-base-200/50 active:bg-base-200 transition-colors"
          onClick={() => onSelectLocus(l.locus_id)}
        >
          {studyColors?.[l.study_id ?? ""] && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: studyColors[l.study_id ?? ""] }}
            />
          )}
          <span className="text-sm font-medium min-w-0">
            {labelByGene && l.nearest_gene && l.nearest_gene !== "-"
              ? l.nearest_gene
              : l.locus_name || l.locus_id}
          </span>
          <span className="text-xs text-base-content/40 hidden sm:inline">
            {formatCoordinate(l.chromosome, l.start_position, l.end_position)}
          </span>
          {studies && (
            <span className="text-xs text-base-content/40 hidden md:inline">
              {studies.find((s) => s.study_id === l.study_id)?.gwas_source}
            </span>
          )}
          <span className="text-xs text-base-content/40 ml-auto tabular-nums shrink-0">
            {l.n_candidate_genes} genes
          </span>
        </button>
        );
      })}
    </div>
  );
}

// --- Locus detail view ---

function LocusDetail({
  locus,
  studyColor,
  studyLabel,
}: {
  locus: Locus;
  studyColor?: string;
  studyLabel?: string;
}) {
  const { data: genes, isLoading, error } = useLocusGenes(locus.locus_id);
  const { data: categories } = useEvidenceCategories();

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-1">
        {studyColor && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: studyColor }}
          />
        )}
        <h4 className="text-sm font-medium text-base-content/60">
          {locus.locus_name || locus.locus_id}
        </h4>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mb-3">
        <span>
          {formatCoordinate(locus.chromosome, locus.start_position, locus.end_position)}
        </span>
        {studyLabel && <span>{studyLabel}</span>}
        {locus.nearest_gene && locus.nearest_gene !== "-" && (
          <span>Nearest: {locus.nearest_gene}</span>
        )}
        {locus.lead_rsid && locus.lead_rsid !== "-" && (
          <span>Lead: {locus.lead_rsid}</span>
        )}
        {locus.lead_pvalue && locus.lead_pvalue !== "-" && (
          <span>P: {formatPvalue(locus.lead_pvalue)}</span>
        )}
        <span>
          {locus.n_candidate_genes} candidate gene{locus.n_candidate_genes !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorAlert message={error.message} />}
      {genes && categories && (
        <EvidenceHeatmap genes={genes} categories={categories} />
      )}
    </div>
  );
}
