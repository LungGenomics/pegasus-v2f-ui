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
import { usePersistentState } from "../../hooks/usePersistentState";

export function LocusDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const locusId = rawId ? decodeURIComponent(rawId) : "";
  // Same persisted flag as the trait page's loci view — the heatmap owns the
  // toggle here (no loci list to host it).
  const [evidenceOnly, setEvidenceOnly] = usePersistentState<boolean>(
    "pegasus-v2f.evidenceOnly",
    true,
  );

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
        <div className="text-xs font-medium uppercase tracking-wide text-base-content/40">
          Locus
        </div>
        <p className="text-sm text-base-content/40 mt-2 font-mono">{locusId}</p>
        <p className="text-sm text-base-content/40 mt-4">Locus not found.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="text-xs font-medium uppercase tracking-wide text-base-content/40">
        Locus
      </div>
      <h1 className="text-lg font-semibold font-mono">
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
        <span>{locus.n_candidate_genes ?? 0} candidate genes</span>
        <span title="GWAS sentinel (lead) variants merged into this locus window">
          {locus.n_signals ?? 0}{" "}
          {locus.n_signals === 1 ? "sentinel" : "merged sentinels"}
        </span>
      </div>
      {/* Lead variant of the window. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mt-1">
        {locus.lead_rsid && <span>Lead {locus.lead_rsid}</span>}
        {locus.lead_pvalue != null && <span>p = {formatPvalue(locus.lead_pvalue)}</span>}
      </div>

      {/* Candidate genes × evidence (the locus's own trait). */}
      <div className="flex items-center justify-between gap-3 mt-6 mb-2">
        <h2 className="text-sm font-medium text-base-content/60">Candidate genes</h2>
      </div>
      {genesQ.isLoading ? (
        <p className="text-sm text-base-content/40">Loading…</p>
      ) : (
        <EvidenceHeatmap
          genes={genesQ.data ?? []}
          categories={EVIDENCE_CATEGORIES}
          evidenceOnly={evidenceOnly}
          onEvidenceOnlyChange={setEvidenceOnly}
        />
      )}

      {/* Traits at this locus — linked list (traverse). The locus is owned by
          ONE trait (it defined the window); others are cross-trait evidence
          overlapping it (pleiotropy), marked below. */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Traits ({traits.length})
      </h2>
      {traits.length === 0 ? (
        <p className="text-xs text-base-content/40">No trait evidence at this locus.</p>
      ) : (
        <div className="border border-base-300 rounded-md divide-y divide-base-300">
          {traits.map((t) => {
            const isOwner = t.trait_id === locus.trait_id;
            return (
              <Link
                key={t.trait_id}
                to={`/traits?trait=${encodeURIComponent(t.trait_id)}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-base-200/50"
              >
                <span className="font-medium min-w-0 truncate">{t.label}</span>
                {isOwner ? (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0"
                    title="This trait defined the locus — its GWAS sentinel(s) drew the window."
                  >
                    locus source
                    {locus.source_tag && (
                      <span className="normal-case font-mono"> · {locus.source_tag}</span>
                    )}
                  </span>
                ) : (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-base-200 text-base-content/60 shrink-0"
                    title="This trait's evidence overlaps the locus but did not define it (cross-trait / pleiotropy)."
                  >
                    cross-trait overlap
                  </span>
                )}
                <span className="text-xs text-base-content/40 tabular-nums ml-auto">
                  {t.n_genes} genes
                </span>
                <span className="text-xs text-base-content/40 tabular-nums">
                  {t.n_evidence} evidence
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
