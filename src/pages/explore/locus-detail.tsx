// Locus detail page — the hub. Header (cytoband + coords + lead variant),
// the per-locus evidence heatmap (genes × categories, all traits), and the
// traits implicated at this locus as a linked list (traverse one hop). Reuses
// the trait-detail building blocks.

import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getLocus,
  locusGenes,
  locusTraits,
} from "../../data/queries/explore";
import { EVIDENCE_CATEGORIES } from "../../data/static";
import { EvidenceHeatmap } from "../../components/locus-detail-pane/evidence-heatmap";
import { formatCoordinate, formatPvalue } from "../../lib/format";
import { Breadcrumb } from "./breadcrumb";

export function LocusDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const locusId = rawId ? decodeURIComponent(rawId) : "";

  const locusQ = useQuery({
    queryKey: ["explore", "locus", locusId],
    queryFn: () => getLocus(locusId),
    enabled: !!locusId,
  });
  // Loci are trait-scoped — the heatmap shows the locus's own (same-trait)
  // evidence. (Cross-trait/pleiotropy is a deferred page-level feature.)
  const genesQ = useQuery({
    queryKey: ["explore", "locus-genes", locusId],
    queryFn: () => locusGenes(locusId),
    enabled: !!locusId,
  });
  const traitsQ = useQuery({
    queryKey: ["explore", "locus-traits", locusId],
    queryFn: () => locusTraits(locusId),
    enabled: !!locusId,
  });

  const locus = locusQ.data;
  const traits = traitsQ.data ?? [];

  if (locusQ.isLoading) {
    return <p className="text-sm text-base-content/40">Loading…</p>;
  }
  if (!locus) {
    return (
      <div>
        <Breadcrumb name={locusId} />
        <p className="text-sm text-base-content/40 mt-4">Locus not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <Breadcrumb name={locus.locus_name || locus.locus_id} />
      <h1 className="text-lg font-semibold font-mono mt-2">
        {locus.locus_name || locus.locus_id}
      </h1>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mt-1">
        <span className="font-mono">
          {formatCoordinate(
            locus.chromosome ?? "",
            locus.start_position ?? 0,
            locus.end_position ?? 0,
          )}
        </span>
        {locus.lead_rsid && <span>Lead {locus.lead_rsid}</span>}
        {locus.lead_pvalue != null && <span>p = {formatPvalue(locus.lead_pvalue)}</span>}
        <span>{locus.n_signals ?? 0} signals</span>
        <span>{locus.n_candidate_genes ?? 0} candidate genes</span>
        {locus.source_tag && (
          <Link
            to={`/sources?source=${encodeURIComponent(locus.source_tag)}`}
            className="text-primary hover:underline font-mono"
          >
            {locus.source_tag}
          </Link>
        )}
      </div>

      {/* Candidate genes × evidence (the locus's own trait). */}
      <div className="flex items-center justify-between gap-3 mt-6 mb-2">
        <h2 className="text-sm font-medium text-base-content/60">Candidate genes</h2>
      </div>
      {genesQ.isLoading ? (
        <p className="text-sm text-base-content/40">Loading…</p>
      ) : (
        <EvidenceHeatmap genes={genesQ.data ?? []} categories={EVIDENCE_CATEGORIES} />
      )}

      {/* Traits at this locus — linked list (traverse) */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Traits ({traits.length})
      </h2>
      {traits.length === 0 ? (
        <p className="text-xs text-base-content/40">No trait evidence at this locus.</p>
      ) : (
        <div className="border border-base-300 rounded-md divide-y divide-base-300">
          {traits.map((t) => (
            <Link
              key={t.trait_id}
              to={`/traits?trait=${encodeURIComponent(t.trait_id)}`}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-base-200/50"
            >
              <span className="font-medium flex-1 min-w-0 truncate">{t.label}</span>
              <span className="text-xs text-base-content/40 tabular-nums">
                {t.n_genes} genes
              </span>
              <span className="text-xs text-base-content/40 tabular-nums">
                {t.n_evidence} evidence
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
