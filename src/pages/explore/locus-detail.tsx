// Locus detail page — the hub. Header (cytoband + coords + lead variant),
// the per-locus evidence heatmap (genes × categories, all traits), and the
// traits implicated at this locus as a linked list (traverse one hop). Reuses
// the trait-detail building blocks.

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  getLocus,
  locusGenes,
  locusTraits,
  type TraitLink,
} from "../../data/queries/explore";
import { EVIDENCE_CATEGORIES } from "../../data/static";
import { EvidenceHeatmap } from "../../components/locus-detail-pane/evidence-heatmap";
import { formatCoordinate, formatPvalue } from "../../lib/format";
import { Breadcrumb } from "./breadcrumb";

export function LocusDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const locusId = rawId ? decodeURIComponent(rawId) : "";

  // Trait filter for the heatmap: empty = all traits (aggregated).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = [...selected];

  const locusQ = useQuery({
    queryKey: ["explore", "locus", locusId],
    queryFn: () => getLocus(locusId),
    enabled: !!locusId,
  });
  const genesQ = useQuery({
    queryKey: ["explore", "locus-genes", locusId, selectedIds.sort().join(",")],
    queryFn: () => locusGenes(locusId, selectedIds.length ? selectedIds : undefined),
    enabled: !!locusId,
  });
  const traitsQ = useQuery({
    queryKey: ["explore", "locus-traits", locusId],
    queryFn: () => locusTraits(locusId),
    enabled: !!locusId,
  });

  const locus = locusQ.data;
  const traits = traitsQ.data ?? [];

  const toggleTrait = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

      {/* Candidate genes × evidence, with a trait filter (all = aggregated) */}
      <div className="flex items-center justify-between gap-3 mt-6 mb-2">
        <h2 className="text-sm font-medium text-base-content/60">Candidate genes</h2>
        {traits.length > 0 && (
          <TraitFilter
            traits={traits}
            selected={selected}
            onToggle={toggleTrait}
            onClear={() => setSelected(new Set())}
          />
        )}
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
              to={`/browse?trait=${encodeURIComponent(t.trait_id)}`}
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

// Compact trait filter: a trigger showing the current scope, opening a
// scrollable checklist. Scales to many traits (vs a pill row).
function TraitFilter({
  traits,
  selected,
  onToggle,
  onClear,
}: {
  traits: TraitLink[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
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

  const label =
    selected.size === 0
      ? "All traits"
      : selected.size === 1
        ? (traits.find((t) => selected.has(t.trait_id))?.label ?? "1 trait")
        : `${selected.size} traits`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs border border-base-300 rounded-md px-2 py-1 text-base-content/70 hover:text-base-content cursor-pointer"
      >
        {label}
        <ChevronDown className="size-3.5 text-base-content/40" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[12rem] max-h-64 overflow-auto border border-base-300 rounded-md bg-base-100 shadow-md py-1 text-sm">
          <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-base-200/50">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={selected.size === 0}
              onChange={onClear}
            />
            All traits
          </label>
          <div className="border-t border-base-300 my-1" />
          {traits.map((t) => (
            <label
              key={t.trait_id}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-base-200/50"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={selected.has(t.trait_id)}
                onChange={() => onToggle(t.trait_id)}
              />
              <span className="flex-1 min-w-0 truncate">{t.label}</span>
              <span className="text-xs text-base-content/40 tabular-nums shrink-0">
                {t.n_evidence}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
