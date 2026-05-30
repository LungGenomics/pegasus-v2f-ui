// Trait detail page — genome track + loci list + per-locus evidence heatmap,
// recomposed over the redesigned relations (plan 2026-05-29). The track,
// TrackControls, and EvidenceHeatmap are the surviving old-UI components; the
// data comes from queries/explore.ts (traitLoci / locusGenes / traitSources).
//
// The viewport→list filtering (hide list rows outside the track's current
// zoom, imperative DOM toggling to avoid re-renders during pan/zoom) is ported
// from the old trait-detail page — Sam wanted it kept.

import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { X, Pencil } from "lucide-react";
import { useSyncSession } from "../../hooks/useSyncSession";
import { TraitEditor } from "../../components/trait-editor/trait-editor";
import {
  getTrait,
  traitLoci,
  traitSourceTags,
  traitSources,
  locusGenes,
  type LocusRow,
} from "../../data/queries/explore";
import { fetchChromSizes } from "../../data/chromSizes";
import { EVIDENCE_CATEGORIES } from "../../data/static";
import { GenomeTrack, type GenomeTrackHandle } from "../../components/genome-track/genome-track";
import { TrackControls } from "../../components/genome-track/track-controls";
import { EvidenceHeatmap } from "../../components/locus-detail-pane/evidence-heatmap";
import type { TrackLocus, ViewState } from "../../components/genome-track/types";
import { buildChromList, chromOffsets, toAbsolute } from "../../lib/genome-coords";
import { formatCoordinate, formatPvalue } from "../../lib/format";
import { STUDY_PALETTE } from "../../lib/colors";

function withChr(c: string): string {
  return c.startsWith("chr") ? c : `chr${c}`;
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
  const lociQ = useQuery({
    queryKey: ["explore", "trait-loci", traitId],
    queryFn: () => traitLoci(traitId),
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

  const loci = useMemo(() => lociQ.data ?? [], [lociQ.data]);
  const sourceTags = tagsQ.data ?? [];
  const multiSource = sourceTags.length > 1;
  const trackRef = useRef<GenomeTrackHandle>(null);

  const [locusFilter, setLocusFilter] = useState("");
  // Loci are named by cytoband (locus_name); the coordinate is derivable from
  // the geometry. Toggle which one labels the track + list.
  const [labelMode, setLabelMode] = useState<"cytoband" | "coords">("cytoband");

  const lociLabel = useCallback(
    (l: LocusRow): string =>
      labelMode === "coords"
        ? formatCoordinate(l.chromosome ?? "", l.start_position ?? 0, l.end_position ?? 0)
        : l.locus_name || l.lead_rsid || l.locus_id,
    [labelMode],
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
      const hay = [l.locus_name, l.locus_id, l.lead_rsid, l.chromosome, l.source_tag]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) {
        filtered.push(tl);
        indices.add(i);
      }
    });
    return { filteredTrackLoci: filtered, matchingIndices: indices };
  }, [trackLoci, loci, locusFilter]);

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
    <div className="h-full overflow-auto">
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
        <div className="mt-4">
          <GenomeTrack
            ref={trackRef}
            loci={filteredTrackLoci}
            selectedLocusId={selectedLocusId}
            onLocusSelect={setSelectedLocus}
            onViewChange={handleViewChange}
            chromNames={chromQ.data.names}
            chromLengths={chromQ.data.lengths}
            traitColors={multiSource ? sourceColors : undefined}
          />
        </div>
      )}

      {/* Loci header: count + filter + track controls */}
      <div className="flex flex-wrap items-center gap-3 mt-3 mb-2">
        <h3 className="text-sm font-medium text-base-content/60 shrink-0">
          <span ref={lociCountRef}>Loci ({loci.length})</span>
        </h3>
        <label className="input input-bordered input-xs flex items-center gap-1 w-44">
          <input
            type="text"
            className="grow"
            placeholder="Filter loci…"
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
        <div className="inline-flex bg-base-200 rounded-md p-0.5 text-xs">
          {(["cytoband", "coords"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setLabelMode(m)}
              className={`px-2 py-0.5 rounded-md cursor-pointer ${
                labelMode === m
                  ? "bg-base-100 text-base-content font-medium shadow-sm"
                  : "text-base-content/60 hover:text-base-content"
              }`}
            >
              {m === "cytoband" ? "Cytoband" : "Coordinates"}
            </button>
          ))}
        </div>
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

      {/* Loci list / selected-locus detail */}
      <LociPane
        loci={loci}
        traitId={traitId}
        listRef={listRef}
        selectedLocusId={selectedLocusId}
        onSelect={setSelectedLocus}
        sourceColors={multiSource ? sourceColors : undefined}
        labelMode={labelMode}
      />

      <TraitSourcesPanel traitId={traitId} />
    </div>
  );
}

// --- Loci list + selected locus heatmap ---

function LociPane({
  loci,
  traitId,
  listRef,
  selectedLocusId,
  onSelect,
  sourceColors,
  labelMode,
}: {
  loci: LocusRow[];
  traitId: string;
  listRef: React.Ref<HTMLDivElement>;
  selectedLocusId?: string;
  onSelect: (id: string | null) => void;
  sourceColors?: Record<string, string>;
  labelMode: "cytoband" | "coords";
}) {
  const cyto = (l: LocusRow) => l.locus_name || l.locus_id;
  const coord = (l: LocusRow) =>
    formatCoordinate(l.chromosome ?? "", l.start_position ?? 0, l.end_position ?? 0);
  const selected = selectedLocusId
    ? loci.find((l) => l.locus_id === selectedLocusId)
    : undefined;

  if (loci.length === 0) {
    return (
      <div className="border border-base-300 rounded-lg px-3 py-4 text-sm text-base-content/40 text-center">
        No loci for this trait.
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
        <LocusDetail locus={selected} traitId={traitId} />
      </div>
    );
  }

  return (
    <div ref={listRef} className="border border-base-300 rounded-lg overflow-hidden">
      {loci.map((l, i) => (
        <button
          key={l.locus_id}
          data-locus-idx={i}
          className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-base-300 -mt-px first:border-t-0 first:mt-0 hover:bg-base-200/50"
          onClick={() => onSelect(l.locus_id)}
        >
          {sourceColors?.[l.source_tag ?? ""] && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: sourceColors[l.source_tag ?? ""] }}
            />
          )}
          <span className="text-sm font-medium font-mono min-w-0 truncate">
            {labelMode === "coords" ? coord(l) : cyto(l)}
          </span>
          <span className="text-xs text-base-content/40 hidden sm:inline">
            {labelMode === "coords" ? cyto(l) : coord(l)}
          </span>
          <span className="text-xs text-base-content/40 ml-auto tabular-nums shrink-0">
            {l.n_candidate_genes ?? 0} genes
          </span>
        </button>
      ))}
    </div>
  );
}

function LocusDetail({ locus, traitId }: { locus: LocusRow; traitId: string }) {
  const genesQ = useQuery({
    queryKey: ["explore", "locus-genes", locus.locus_id, traitId],
    queryFn: () => locusGenes(locus.locus_id, [traitId]),
  });

  return (
    <div className="p-4">
      <h4 className="text-sm font-medium text-base-content/70 font-mono">
        {locus.locus_name || locus.locus_id}
      </h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mt-1 mb-3">
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
        <EvidenceHeatmap genes={genesQ.data ?? []} categories={EVIDENCE_CATEGORIES} />
      )}
    </div>
  );
}

// --- Contributing sources ---

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
      <h3 className="text-sm font-medium text-base-content/60 mb-3">
        Sources contributing ({rows.length})
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
