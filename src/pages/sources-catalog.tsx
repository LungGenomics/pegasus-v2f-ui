import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, ChevronDown, ChevronRight, X } from "lucide-react";
import { useProvenance, useSourceEvidence, useSourceVariants } from "../api/sources";
import { useChromSizes } from "../api/db";
import { GenomeTrack, type GenomeTrackHandle } from "../components/genome-track/genome-track";
import { GenomeScatter, type GenomeScatterHandle, type ScatterPoint } from "../components/genome-track/genome-scatter";
import { TrackControls } from "../components/genome-track/track-controls";
import type { TrackLocus, ViewState } from "../components/genome-track/types";
import type { SourceProvenance, SourceEvidenceRow } from "../api/types";
import { buildChromList, chromOffsets, toAbsolute } from "../lib/genome-coords";
import { formatPvalue, formatScore } from "../lib/format";

/** Category abbreviation → Tailwind text color class */
const CATEGORY_COLORS: Record<string, string> = {
  QTL: "text-blue-500",
  COLOC: "text-blue-500",
  GWAS: "text-purple-500",
  MR: "text-emerald-500",
  FUNC: "text-purple-500",
  PROX: "text-teal-500",
  RARE: "text-rose-500",
  OMICS: "text-blue-500",
  OTHER: "text-base-content/60",
};

const CATEGORY_DOTS: Record<string, string> = {
  QTL: "bg-blue-500",
  COLOC: "bg-blue-500",
  GWAS: "bg-purple-500",
  MR: "bg-emerald-500",
  FUNC: "bg-purple-500",
  PROX: "bg-teal-500",
  RARE: "bg-rose-500",
  OMICS: "bg-blue-500",
  OTHER: "bg-base-content/40",
};

export function SourcesCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedSource = searchParams.get("source");
  const fromKind = searchParams.get("from"); // "trait" | "gene" | null
  const fromId = searchParams.get("fromId"); // decoded by useSearchParams

  const { data: provenance, isLoading } = useProvenance();

  if (selectedSource && provenance) {
    const source = provenance.find((s) => s.source_tag === selectedSource);
    return (
      <SourceDetail
        sourceTag={selectedSource}
        source={source ?? null}
        fromKind={fromKind}
        fromId={fromId}
        onBack={() => {
          // If we have a structured referrer, route back to its detail
          // page (re-encoding fromId so slashes in trait names survive).
          if (fromKind && fromId) {
            const base =
              fromKind === "trait"
                ? "traits"
                : fromKind === "gene"
                  ? "genes"
                  : null;
            if (base) {
              navigate(`/${base}/${encodeURIComponent(fromId)}`);
              return;
            }
          }
          setSearchParams({});
        }}
      />
    );
  }

  return (
    <div>
      <h1 className="text-lg font-medium mb-4">Sources</h1>

      {isLoading && (
        <div className="text-base-content/40">Loading sources...</div>
      )}

      {provenance && provenance.length === 0 && (
        <div className="text-base-content/40">No sources in database.</div>
      )}

      {provenance && provenance.length > 0 && (
        <div className="space-y-1">
          {provenance.map((source) => (
            <button
              key={source.source_tag}
              className="w-full text-left px-4 py-3 rounded-lg bg-base-100 border border-base-300 hover:border-primary/30 transition-colors"
              onClick={() => setSearchParams({ source: source.source_tag })}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOTS[source.evidence_category] ?? CATEGORY_DOTS.OTHER}`}
                />
                <span className="font-mono font-medium text-sm">
                  {source.source_tag}
                </span>
                <span
                  className={`text-xs font-medium ${CATEGORY_COLORS[source.evidence_category] ?? CATEGORY_COLORS.OTHER}`}
                >
                  {source.evidence_category}
                </span>
                <span className="text-xs text-base-content/40 ml-auto tabular-nums">
                  {source.record_count} records
                </span>
              </div>
              {source.source_name && (
                <div className="text-xs text-base-content/50 mt-0.5 ml-5">
                  {source.source_name}
                  {source.source_type && (
                    <span className="text-base-content/30">
                      {" "}
                      &middot; {source.source_type}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Source detail view ---

const fmtVal = (v: unknown) => {
  if (v == null || String(v) === "-" || String(v) === "") return null;
  return String(v);
};

/** Map structured ?from= + ?fromId= referrer to a back-link label. The
 *  id is already decoded by useSearchParams. */
function backLinkLabel(
  fromKind: string | null,
  fromId: string | null,
): string {
  if (!fromKind || !fromId) return "Sources";
  if (fromKind === "trait" || fromKind === "gene") return fromId;
  return "Back";
}

function SourceDetail({
  sourceTag,
  source,
  fromKind,
  fromId,
  onBack,
}: {
  sourceTag: string;
  source: SourceProvenance | null;
  /** Referrer kind from `?from=` — "trait" or "gene", or null when the
   *  user landed cold. Drives the back-link label and target. */
  fromKind: string | null;
  /** Decoded id of the referrer (trait name or gene symbol). */
  fromId: string | null;
  onBack: () => void;
}) {
  const { data, isLoading } = useSourceEvidence(sourceTag);
  const chromQ = useChromSizes();
  const trackRef = useRef<GenomeTrackHandle>(null);
  const scatterRef = useRef<GenomeScatterHandle>(null);
  const [filter, setFilter] = useState("");
  const [viewport, setViewport] = useState<ViewState | null>(null);
  const [labelByGene, setLabelByGene] = useState(true);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [showRawTable, setShowRawTable] = useState(false);

  const loci = data?.loci;
  const evidence = data?.evidence;
  const profile = data?.data_profile;

  // Determine visualization mode
  const vizMode: "scatter-variant" | "scatter-gene" | "markers" = useMemo(() => {
    if (!profile) return "markers";
    if (profile.has_positions) return "scatter-variant";
    if (profile.has_scores || profile.has_pvalues) return "scatter-gene";
    return "markers";
  }, [profile]);

  // Fetch variants only for variant-level sources
  const { data: variants } = useSourceVariants(
    sourceTag,
    vizMode === "scatter-variant",
  );

  // Build gene labels per locus from evidence rows
  const locusGeneLabels = useMemo(() => {
    if (!evidence) return new Map<string, string>();
    const byLocus = new Map<string, Set<string>>();
    for (const ev of evidence) {
      if (!byLocus.has(ev.locus_id)) byLocus.set(ev.locus_id, new Set());
      byLocus.get(ev.locus_id)!.add(ev.gene_symbol);
    }
    const labels = new Map<string, string>();
    for (const [id, genes] of byLocus) {
      const arr = Array.from(genes);
      labels.set(id, arr.length <= 2 ? arr.join(", ") : `${arr[0]} +${arr.length - 1}`);
    }
    return labels;
  }, [evidence]);

  // All track loci (unfiltered)
  const allTrackLoci: TrackLocus[] = useMemo(() => {
    if (!loci) return [];
    return loci.map((l) => ({
      id: l.locus_id,
      chr: l.chromosome.startsWith("chr") ? l.chromosome : `chr${l.chromosome}`,
      start: typeof l.start_position === "number" ? l.start_position : Number(l.start_position),
      end: typeof l.end_position === "number" ? l.end_position : Number(l.end_position),
      label: labelByGene
        ? (locusGeneLabels.get(l.locus_id) ?? l.locus_name)
        : l.locus_name,
      score: typeof l.max_score === "number" ? l.max_score : Number(l.max_score) || undefined,
      pvalue: l.lead_pvalue != null ? Number(l.lead_pvalue) : undefined,
    }));
  }, [loci, locusGeneLabels, labelByGene]);

  // Absolute bp positions for viewport filtering
  const locusAbsPositions = useMemo(() => {
    if (!loci || !chromQ.data) return null;
    const chroms = buildChromList(chromQ.data.names, chromQ.data.lengths);
    const { offsets } = chromOffsets(chroms);
    const map = new Map<string, { start: number; end: number }>();
    for (const l of loci) {
      const chr = l.chromosome.startsWith("chr") ? l.chromosome : `chr${l.chromosome}`;
      try {
        map.set(l.locus_id, {
          start: toAbsolute(chr, Number(l.start_position), offsets),
          end: toAbsolute(chr, Number(l.end_position), offsets),
        });
      } catch { /* skip unknown chroms */ }
    }
    return map;
  }, [loci, chromQ.data]);

  const totalGenomeLength = useMemo(() => {
    if (!chromQ.data) return 0;
    return chromQ.data.lengths.reduce((a, b) => a + b, 0);
  }, [chromQ.data]);

  // Build scatter points for gene-level scored sources
  const geneScatterPoints: ScatterPoint[] = useMemo(() => {
    if (vizMode !== "scatter-gene" || !evidence || !loci || !chromQ.data) return [];
    // Build locus centroid lookup
    const locusCentroid = new Map<string, { chr: string; pos: number }>();
    for (const l of loci) {
      const chr = l.chromosome.startsWith("chr") ? l.chromosome : `chr${l.chromosome}`;
      const start = Number(l.start_position);
      const end = Number(l.end_position);
      locusCentroid.set(l.locus_id, { chr, pos: Math.round((start + end) / 2) });
    }

    const points: ScatterPoint[] = [];
    for (const ev of evidence) {
      const centroid = locusCentroid.get(ev.locus_id);
      if (!centroid) continue;
      // Determine y value: prefer score, fall back to -log10(pvalue)
      let y: number | null = null;
      if (ev.score != null && String(ev.score) !== "-" && String(ev.score) !== "") {
        y = Number(ev.score);
      } else if (ev.pvalue != null && String(ev.pvalue) !== "-" && String(ev.pvalue) !== "") {
        const p = Number(ev.pvalue);
        if (p > 0) y = -Math.log10(p);
      }
      if (y == null || isNaN(y)) continue;

      points.push({
        id: `${ev.locus_id}_${ev.gene_symbol}_${points.length}`,
        chr: centroid.chr,
        pos: centroid.pos,
        y,
        label: ev.gene_symbol,
        locusId: ev.locus_id,
      });
    }
    return points;
  }, [vizMode, evidence, loci, chromQ.data]);

  // Build scatter points for variant-level sources
  const variantScatterPoints: ScatterPoint[] = useMemo(() => {
    if (vizMode !== "scatter-variant" || !variants) return [];
    const points: ScatterPoint[] = [];
    for (const v of variants) {
      const chr = String(v.chromosome).startsWith("chr") ? String(v.chromosome) : `chr${v.chromosome}`;
      let y: number | null = null;
      if (v.pvalue != null && String(v.pvalue) !== "-" && String(v.pvalue) !== "") {
        const p = Number(v.pvalue);
        if (p > 0) y = -Math.log10(p);
      } else if (v.score != null && String(v.score) !== "-" && String(v.score) !== "") {
        y = Number(v.score);
      } else if (v.effect_size != null && String(v.effect_size) !== "-" && String(v.effect_size) !== "") {
        y = Number(v.effect_size);
      }
      if (y == null || isNaN(y)) continue;

      points.push({
        id: `${v.rsid ?? ""}_${v.gene_symbol}_${points.length}`,
        chr,
        pos: Number(v.position),
        y,
        label: v.rsid ?? v.gene_symbol,
        locusId: undefined,
      });
    }
    return points;
  }, [vizMode, variants]);

  // Determine the y-axis field for variant sources
  const variantYField = useMemo(() => {
    if (!variants || variants.length === 0) return null;
    if (variants.some((v) => v.pvalue != null && String(v.pvalue) !== "-")) return "pvalue";
    if (variants.some((v) => v.score != null && String(v.score) !== "-")) return "score";
    if (variants.some((v) => v.effect_size != null && String(v.effect_size) !== "-")) return "effect_size";
    return null;
  }, [variants]);

  const scatterPoints = vizMode === "scatter-variant" ? variantScatterPoints : geneScatterPoints;

  // Derive selected locus from selected scatter point (for gene scatter → accordion)
  const selectedLocusId = useMemo(() => {
    if (!selectedPointId) return null;
    const pt = scatterPoints.find((p) => p.id === selectedPointId);
    return pt?.locusId ?? null;
  }, [selectedPointId, scatterPoints]);
  const scatterYLabel = useMemo(() => {
    if (!profile) return undefined;
    if (vizMode === "scatter-variant") {
      if (variantYField === "pvalue") return "-log₁₀(p)";
      if (variantYField === "effect_size") return "effect size";
      return "score";
    }
    if (vizMode === "scatter-gene") {
      return profile.has_scores ? "score" : "-log₁₀(p)";
    }
    return undefined;
  }, [vizMode, profile, variantYField]);

  const viewChangeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleViewChange = useCallback((view: ViewState) => {
    // Debounce to avoid re-rendering on every animation frame during zoom
    clearTimeout(viewChangeTimer.current);
    viewChangeTimer.current = setTimeout(() => setViewport(view), 100);
  }, []);

  // Text filter: find matching locus IDs from evidence + loci
  const matchingLocusIds = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null; // null = no text filter active

    const matchIds = new Set<string>();
    if (evidence) {
      for (const ev of evidence) {
        const haystack = [
          ev.gene_symbol, ev.locus_name, ev.rsid, ev.tissue, ev.cell_type,
        ].filter(Boolean).join(" ").toLowerCase();
        if (haystack.includes(q)) matchIds.add(ev.locus_id);
      }
    }
    if (loci) {
      for (const l of loci) {
        const haystack = [l.locus_name, l.chromosome].join(" ").toLowerCase();
        if (haystack.includes(q)) matchIds.add(l.locus_id);
      }
    }
    return matchIds;
  }, [filter, evidence, loci]);

  // Viewport filter: which loci are visible in the current zoom
  const viewportLocusIds = useMemo(() => {
    if (!viewport || !locusAbsPositions) return null;
    const viewSpan = viewport.endBp - viewport.startBp;
    if (viewSpan >= totalGenomeLength * 0.95) return null; // fully zoomed out = show all
    const ids = new Set<string>();
    for (const [id, pos] of locusAbsPositions) {
      if (pos.end >= viewport.startBp && pos.start <= viewport.endBp) {
        ids.add(id);
      }
    }
    return ids;
  }, [viewport, locusAbsPositions, totalGenomeLength]);

  // Combined filter: text AND viewport
  const visibleLocusIds = useMemo(() => {
    if (!matchingLocusIds && !viewportLocusIds) return null;
    if (matchingLocusIds && !viewportLocusIds) return matchingLocusIds;
    if (!matchingLocusIds && viewportLocusIds) return viewportLocusIds;
    // Intersection
    const ids = new Set<string>();
    for (const id of matchingLocusIds!) {
      if (viewportLocusIds!.has(id)) ids.add(id);
    }
    return ids;
  }, [matchingLocusIds, viewportLocusIds]);

  // Track loci filtered by text only (track does its own viewport clipping)
  const filteredTrackLoci = useMemo(() => {
    if (!matchingLocusIds) return allTrackLoci;
    return allTrackLoci.filter((tl) => matchingLocusIds.has(tl.id));
  }, [allTrackLoci, matchingLocusIds]);

  // Group evidence by locus for display (filtered by text + viewport)
  const groupedEvidence = useMemo(() => {
    if (!evidence) return [];
    const byLocus = new Map<string, { locusName: string; studyId: string; rows: SourceEvidenceRow[] }>();
    for (const ev of evidence) {
      if (visibleLocusIds && !visibleLocusIds.has(ev.locus_id)) continue;
      if (!byLocus.has(ev.locus_id)) {
        byLocus.set(ev.locus_id, { locusName: ev.locus_name, studyId: ev.study_id, rows: [] });
      }
      byLocus.get(ev.locus_id)!.rows.push(ev);
    }
    return Array.from(byLocus.values());
  }, [evidence, visibleLocusIds]);

  // Determine which context columns have data across all evidence
  const contextCols = useMemo(() => {
    if (!evidence) return { tissue: false, cellType: false, ancestry: false, sex: false, effectSize: false };
    const has = (fn: (e: SourceEvidenceRow) => unknown) => evidence.some((e) => fmtVal(fn(e)) != null);
    return {
      tissue: has((e) => e.tissue),
      cellType: has((e) => e.cell_type),
      ancestry: has((e) => e.ancestry),
      sex: has((e) => e.sex),
      effectSize: has((e) => e.effect_size),
    };
  }, [evidence]);

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content mb-2"
        >
          <ArrowLeft className="size-3.5" />
          {backLinkLabel(fromKind, fromId)}
        </button>
        <h1 className="text-lg font-medium font-mono">{sourceTag}</h1>
        {source && (
          <div className="flex items-center gap-2 mt-1 text-sm text-base-content/60">
            {source.evidence_category && (
              <span
                className={`font-medium ${CATEGORY_COLORS[source.evidence_category] ?? CATEGORY_COLORS.OTHER}`}
              >
                {source.evidence_category}
              </span>
            )}
            {source.source_type && <span>&middot; {source.source_type}</span>}
            {source.record_count != null && (
              <span>&middot; {source.record_count} records</span>
            )}
            {source.source_name && <span>&middot; {source.source_name}</span>}
          </div>
        )}
      </div>

      {/* Genome visualization */}
      {chromQ.data && vizMode !== "markers" && scatterPoints.length > 0 && (
        <div className="mb-2">
          <GenomeScatter
            ref={scatterRef}
            points={scatterPoints}
            chromNames={chromQ.data.names}
            chromLengths={chromQ.data.lengths}
            yLabel={scatterYLabel}
            thresholdY={variantYField === "pvalue" ? -Math.log10(5e-8) : undefined}
            selectedPointId={selectedPointId ?? undefined}
            onPointSelect={setSelectedPointId}
            onViewChange={handleViewChange}
          />
        </div>
      )}
      {chromQ.data && vizMode === "markers" && allTrackLoci.length > 0 && (
        <div className="mb-2">
          <GenomeTrack
            ref={trackRef}
            loci={filteredTrackLoci}
            chromNames={chromQ.data.names}
            chromLengths={chromQ.data.lengths}
            onLocusSelect={() => {}}
            onViewChange={handleViewChange}
          />
        </div>
      )}

      {/* Evidence header: title + filter + track controls */}
      <div className="flex items-center gap-3 mt-2 mb-2">
        <h3 className="text-sm font-medium text-base-content/60 shrink-0">
          Evidence
          {evidence && (
            <span className="text-base-content/30 ml-1">
              ({evidence.length} rows across {groupedEvidence.length} loci)
            </span>
          )}
        </h3>
        <label className="input input-bordered input-xs flex items-center gap-1 w-48">
          <input
            type="text"
            className="grow"
            placeholder="Filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="text-base-content/30 hover:text-base-content"
              onClick={() => setFilter("")}
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
        <label className="flex items-center gap-1.5 text-xs text-base-content/50 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={showRawTable}
            onChange={(e) => setShowRawTable(e.target.checked)}
          />
          Raw table
        </label>
        {chromQ.data && (allTrackLoci.length > 0 || scatterPoints.length > 0) && (
          <div className="ml-auto">
            <TrackControls
              chromNames={chromQ.data.names}
              onChromSelect={(chr) => (scatterRef.current ?? trackRef.current)?.zoomToChrom(chr)}
              onRegionInput={(chr, s, e) => (scatterRef.current ?? trackRef.current)?.zoomToRegion(chr, s, e)}
              onZoomIn={() => (scatterRef.current ?? trackRef.current)?.zoomIn()}
              onZoomOut={() => (scatterRef.current ?? trackRef.current)?.zoomOut()}
              onReset={() => (scatterRef.current ?? trackRef.current)?.fullReset()}
              onPrevLocus={() => trackRef.current?.navigateLocus(-1)}
              onNextLocus={() => trackRef.current?.navigateLocus(1)}
              hasLoci={(scatterRef.current?.hasLoci ?? trackRef.current?.hasLoci) ?? false}
            />
          </div>
        )}
      </div>

      {/* Evidence table */}
      {isLoading && (
        <div className="text-base-content/40 text-sm">Loading evidence...</div>
      )}

      {showRawTable && evidence && evidence.length > 0 && (
        <RawEvidenceTable evidence={evidence} filter={filter} />
      )}

      {!showRawTable && vizMode === "scatter-variant" && variants && variants.length > 0 && (
        <VariantTable
          variants={variants}
          scatterPoints={variantScatterPoints}
          selectedPointId={selectedPointId}
          onPointSelect={setSelectedPointId}
          filter={filter}
        />
      )}

      {!showRawTable && vizMode !== "scatter-variant" && evidence && evidence.length === 0 && (
        <div className="text-base-content/40 text-sm">
          No scored evidence found for this source.
        </div>
      )}

      {!showRawTable && vizMode !== "scatter-variant" && groupedEvidence.length > 0 && (
        <LocusEvidenceTable
          groups={groupedEvidence}
          contextCols={contextCols}
          dataProfile={profile}
          selectedLocusId={selectedLocusId}
        />
      )}
    </div>
  );
}

// --- Raw evidence table (all columns, flat) ---

function RawEvidenceTable({
  evidence,
  filter,
}: {
  evidence: SourceEvidenceRow[];
  filter: string;
}) {
  const q = filter.trim().toLowerCase();

  // Determine which columns have data
  const cols = useMemo(() => {
    const fields: { key: keyof SourceEvidenceRow; label: string; align?: "right" }[] = [
      { key: "locus_name", label: "locus" },
      { key: "study_id", label: "study" },
      { key: "gene_symbol", label: "gene" },
      { key: "evidence_category", label: "category" },
      { key: "tissue", label: "tissue" },
      { key: "cell_type", label: "cell type" },
      { key: "ancestry", label: "ancestry" },
      { key: "sex", label: "sex" },
      { key: "rsid", label: "rsid" },
      { key: "pvalue", label: "p-value", align: "right" },
      { key: "effect_size", label: "effect", align: "right" },
      { key: "score", label: "score", align: "right" },
    ];
    return fields.filter(({ key }) =>
      evidence.some((r) => {
        const v = r[key];
        return v != null && String(v) !== "-" && String(v) !== "";
      }),
    );
  }, [evidence]);

  const filtered = useMemo(() => {
    if (!q) return evidence;
    return evidence.filter((ev) => {
      const haystack = [
        ev.gene_symbol, ev.locus_name, ev.rsid, ev.tissue, ev.cell_type, ev.study_id,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [evidence, q]);

  return (
    <table className="table table-xs w-full bg-base-100 rounded-lg">
      <thead>
        <tr className="text-base-content/40">
          {cols.map(({ key, label, align }) => (
            <th key={key} className={`font-medium ${align === "right" ? "text-right" : ""}`}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.map((ev, i) => (
          <tr key={i} className="hover">
            {cols.map(({ key, align }) => {
              const raw = ev[key];
              const val = fmtVal(raw);
              let display = val ?? "—";
              if (val && key === "pvalue") display = formatPvalue(raw!);
              else if (val && (key === "score" || key === "effect_size")) display = formatScore(raw!);

              const isGene = key === "gene_symbol" && val;
              return (
                <td
                  key={key}
                  className={`${align === "right" ? "text-right tabular-nums" : ""} ${!val ? "text-base-content/30" : key === "rsid" ? "font-mono text-xs" : ""}`}
                >
                  {isGene ? (
                    <Link
                      to={`/genes/${encodeURIComponent(val!)}`}
                      className="link link-primary"
                    >
                      {val}
                    </Link>
                  ) : (
                    display
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Variant table (for variant-level sources) ---

function VariantTable({
  variants,
  scatterPoints,
  selectedPointId,
  onPointSelect,
  filter,
}: {
  variants: import("../api/types").SourceVariant[];
  scatterPoints: ScatterPoint[];
  selectedPointId: string | null;
  onPointSelect: (id: string | null) => void;
  filter: string;
}) {
  const q = filter.trim().toLowerCase();

  // Filter variants by search
  const filteredVariants = useMemo(() => {
    return variants.map((v, i) => {
      // Find the corresponding scatter point
      const sp = scatterPoints.find(
        (p) => p.label === (v.rsid ?? v.gene_symbol) && p.pos === Number(v.position),
      );
      return { variant: v, idx: i, pointId: sp?.id ?? null };
    }).filter(({ variant }) => {
      if (!q) return true;
      const haystack = [
        variant.rsid, variant.gene_symbol, variant.chromosome,
        variant.tissue, variant.cell_type,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [variants, scatterPoints, q]);

  const hasScore = variants.some((v) => v.score != null && String(v.score) !== "-");
  const hasPval = variants.some((v) => v.pvalue != null && String(v.pvalue) !== "-");
  const hasEffect = variants.some((v) => v.effect_size != null && String(v.effect_size) !== "-");
  const hasTissue = variants.some((v) => v.tissue != null && String(v.tissue) !== "-");

  return (
    <table className="table table-xs w-full bg-base-100 rounded-lg">
      <thead>
        <tr className="text-base-content/40">
          <th className="font-medium">chr</th>
          <th className="font-medium text-right">position</th>
          <th className="font-medium">rsid</th>
          <th className="font-medium">gene</th>
          {hasTissue && <th className="font-medium">tissue</th>}
          {hasPval && <th className="font-medium text-right">p-value</th>}
          {hasEffect && <th className="font-medium text-right">effect</th>}
          {hasScore && <th className="font-medium text-right">score</th>}
        </tr>
      </thead>
      <tbody>
        {filteredVariants.filter(({ pointId }) => {
          if (!selectedPointId) return true;
          return pointId === selectedPointId;
        }).map(({ variant: v, idx, pointId }) => {
          const isSelected = pointId != null && pointId === selectedPointId;
          return (
            <tr
              key={idx}
              className={`hover cursor-pointer ${isSelected ? "bg-primary/10" : ""}`}
              onClick={() => onPointSelect(isSelected ? null : pointId)}
            >
              <td className="text-base-content/60">{v.chromosome}</td>
              <td className="text-right tabular-nums text-base-content/60">
                {Number(v.position).toLocaleString()}
              </td>
              <td className="font-mono text-xs">
                {fmtVal(v.rsid) ?? "—"}
              </td>
              <td>
                <Link
                  to={`/genes/${encodeURIComponent(v.gene_symbol)}`}
                  className="link link-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  {v.gene_symbol}
                </Link>
              </td>
              {hasTissue && (
                <td className="text-base-content/60">{fmtVal(v.tissue) ?? "—"}</td>
              )}
              {hasPval && (
                <td className="text-right tabular-nums text-base-content/60">
                  {v.pvalue != null && String(v.pvalue) !== "-"
                    ? formatPvalue(v.pvalue)
                    : "—"}
                </td>
              )}
              {hasEffect && (
                <td className="text-right tabular-nums text-base-content/60">
                  {v.effect_size != null && String(v.effect_size) !== "-"
                    ? formatScore(v.effect_size)
                    : "—"}
                </td>
              )}
              {hasScore && (
                <td className="text-right tabular-nums">
                  {v.score != null && String(v.score) !== "-"
                    ? formatScore(v.score)
                    : "—"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// --- Locus-grouped evidence table with expandable rows ---

type ContextCols = {
  tissue: boolean;
  cellType: boolean;
  ancestry: boolean;
  sex: boolean;
  effectSize: boolean;
};

type LocusGroup = { locusName: string; studyId: string; rows: SourceEvidenceRow[] };

function LocusEvidenceTable({
  groups,
  contextCols,
  dataProfile,
  selectedLocusId,
}: {
  groups: LocusGroup[];
  contextCols: ContextCols;
  dataProfile?: import("../api/types").SourceDataProfile;
  selectedLocusId?: string | null;
}) {
  const [expandedLoci, setExpandedLoci] = useState<Set<string>>(new Set());

  // Auto-expand selected locus
  useEffect(() => {
    if (!selectedLocusId) return;
    setExpandedLoci((prev) => {
      if (prev.has(selectedLocusId)) return prev;
      const next = new Set(prev);
      next.add(selectedLocusId);
      return next;
    });
  }, [selectedLocusId]);

  const toggleLocus = useCallback((id: string) => {
    setExpandedLoci((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const colCount =
    3 // locus, genes, score
    + (contextCols.tissue ? 1 : 0)
    + (contextCols.cellType ? 1 : 0)
    + (contextCols.ancestry ? 1 : 0)
    + (contextCols.sex ? 1 : 0)
    + 1 // p-value
    + (contextCols.effectSize ? 1 : 0);

  return (
    <table className="table table-xs w-full bg-base-100 rounded-lg">
      <thead>
        <tr className="text-base-content/40">
          <th className="font-medium">locus</th>
          <th className="font-medium">genes</th>
          <th className="font-medium text-right">
            {dataProfile?.has_scores ? "score (max)"
              : dataProfile?.has_pvalues ? "p-value (min)"
              : "value"}
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.filter(({ rows }) => {
          if (!selectedLocusId) return true;
          const id = rows[0]?.locus_id;
          return id === selectedLocusId;
        }).map(({ locusName, studyId, rows }) => {
          const locusId = rows[0]?.locus_id ?? locusName;
          const isExpanded = expandedLoci.has(locusId);
          const geneSet = new Set(rows.map((r) => r.gene_symbol));
          const genes = Array.from(geneSet);
          // Best summary value: score (max), or pvalue (min), or effect_size (max abs)
          let summaryVal: string | null = null;
          if (dataProfile?.has_scores) {
            const vals = rows.map((r) => r.score != null && String(r.score) !== "-" ? Number(r.score) : NaN).filter((s) => !isNaN(s));
            if (vals.length > 0) summaryVal = formatScore(Math.max(...vals));
          } else if (dataProfile?.has_pvalues) {
            const vals = rows.map((r) => r.pvalue != null && String(r.pvalue) !== "-" ? Number(r.pvalue) : NaN).filter((s) => !isNaN(s));
            if (vals.length > 0) summaryVal = formatPvalue(Math.min(...vals));
          }

          const isSelected = locusId === selectedLocusId;

          return (
            <Fragment key={locusId}>
              <tr
                className={`hover cursor-pointer ${isSelected ? "bg-primary/10" : ""}`}
                onClick={() => toggleLocus(locusId)}
              >
                <td className="font-medium">
                  <span className="inline-flex items-center gap-1">
                    {isExpanded
                      ? <ChevronDown className="size-3 text-base-content/30" />
                      : <ChevronRight className="size-3 text-base-content/30" />}
                    {locusName}
                    <span className="text-base-content/30 font-normal text-xs">
                      {studyId}
                    </span>
                  </span>
                </td>
                <td className="text-base-content/60">
                  {genes.length <= 3
                    ? genes.join(", ")
                    : `${genes.slice(0, 3).join(", ")} +${genes.length - 3}`}
                  <span className="text-base-content/30 ml-1">
                    ({rows.length} rows)
                  </span>
                </td>
                <td className="text-right tabular-nums">
                  {summaryVal ?? "—"}
                </td>
              </tr>
              {isExpanded && (
                <tr>
                  <td colSpan={colCount} className="bg-base-200/30 px-4 py-2">
                    <table className="table table-xs w-full">
                      <thead>
                        <tr className="text-base-content/40">
                          <th className="font-medium">gene</th>
                          {contextCols.tissue && <th className="font-medium">tissue</th>}
                          {contextCols.cellType && <th className="font-medium">cell type</th>}
                          {contextCols.ancestry && <th className="font-medium">ancestry</th>}
                          {contextCols.sex && <th className="font-medium">sex</th>}
                          <th className="font-medium">rsid</th>
                          <th className="font-medium text-right">p-value</th>
                          {contextCols.effectSize && <th className="font-medium text-right">effect</th>}
                          <th className="font-medium text-right">score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((ev, i) => (
                          <tr key={i}>
                            <td>
                              <Link
                                to={`/genes/${encodeURIComponent(ev.gene_symbol)}`}
                                className="link link-primary"
                              >
                                {ev.gene_symbol}
                              </Link>
                            </td>
                            {contextCols.tissue && (
                              <td className="text-base-content/60">{fmtVal(ev.tissue) ?? "—"}</td>
                            )}
                            {contextCols.cellType && (
                              <td className="text-base-content/60">{fmtVal(ev.cell_type) ?? "—"}</td>
                            )}
                            {contextCols.ancestry && (
                              <td className="text-base-content/60">{fmtVal(ev.ancestry) ?? "—"}</td>
                            )}
                            {contextCols.sex && (
                              <td className="text-base-content/60">{fmtVal(ev.sex) ?? "—"}</td>
                            )}
                            <td className="text-base-content/40 font-mono text-xs">
                              {fmtVal(ev.rsid) ?? "—"}
                            </td>
                            <td className="text-right tabular-nums text-base-content/60">
                              {ev.pvalue != null && String(ev.pvalue) !== "-"
                                ? formatPvalue(ev.pvalue)
                                : "—"}
                            </td>
                            {contextCols.effectSize && (
                              <td className="text-right tabular-nums text-base-content/60">
                                {ev.effect_size != null && String(ev.effect_size) !== "-"
                                  ? formatScore(ev.effect_size)
                                  : "—"}
                              </td>
                            )}
                            <td className="text-right tabular-nums">
                              {ev.score != null && String(ev.score) !== "-"
                                ? formatScore(ev.score)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
