import { Fragment, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { ArrowUpNarrowWide, ArrowDownWideNarrow, ChevronRight, ChevronDown } from "lucide-react";
import type { LocusGene, LocusGeneEvidence } from "../../api/types";
import { formatScore } from "../../lib/format";
import { categoryHue } from "../../data/static";

type Props = {
  genes: LocusGene[];
  categories: Record<string, string>; // abbreviation -> full name
  onGeneClick?: (gene: string) => void;
  /** When true, hide candidate-only genes (positional overlaps with no
   *  evidence) — show just the genes carrying real evidence. */
  evidenceOnly?: boolean;
  /** When provided, the heatmap renders its own "Evidence only" toggle bound to
   *  this setter (used on the standalone locus page). On the trait page the
   *  loci-header toggle owns the flag, so this is omitted there. */
  onEvidenceOnlyChange?: (v: boolean) => void;
};

type PopoverState = {
  gene: string;
  cat: string;
  items: LocusGeneEvidence[];
  catLabel: string;
  x: number;
  y: number;
  /** Pinned by a click — stays open and is interactive. A hover-opened
   *  popover (pinned=false) is read-only and clears on mouse-leave. */
  pinned: boolean;
} | null;

type SortKey = "#" | "gene" | string;
type SortDir = "asc" | "desc";

export function EvidenceHeatmap({
  genes,
  categories,
  onGeneClick,
  evidenceOnly = false,
  onEvidenceOnlyChange,
}: Props) {
  const categoryKeys = Object.keys(categories);

  // In evidence-only mode keep genes that have GENE-LEVEL evidence
  // (match_type='gene'). Candidate-only genes have empty evidence[]; genes whose
  // only rows are locus-level variant evidence (GWAS/FM/COLOC fanned to the whole
  // locus) aren't gene-resolved, so they're filtered out here too — the GWAS
  // signal stays a locus property, surfaced via the still-shown genes' columns.
  const visibleGenes = useMemo(
    () =>
      evidenceOnly
        ? genes.filter((g) => g.evidence.some((e) => e.match_type === "gene"))
        : genes,
    [genes, evidenceOnly],
  );
  const hiddenCount = genes.length - visibleGenes.length;
  const [popover, setPopover] = useState<PopoverState>(null);
  const [sortKey, setSortKey] = useState<SortKey>("#");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedGenes, setExpandedGenes] = useState<Set<string>>(new Set());
  const popoverRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popover]);

  // Build evidence lookup: gene -> category -> evidence items
  const evidenceMap = useMemo(() => {
    const map = new Map<string, Map<string, LocusGeneEvidence[]>>();
    for (const gene of visibleGenes) {
      const catMap = new Map<string, LocusGeneEvidence[]>();
      for (const ev of gene.evidence) {
        const cat = ev.evidence_category;
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat)!.push(ev);
      }
      map.set(gene.gene_symbol, catMap);
    }
    return map;
  }, [visibleGenes]);

  // Live replacement for the dropped integration_rank: a gene's distinct
  // evidence-category count (the old "gene score" was exactly this). Drives
  // the "#" column + its default sort. 0 for candidate (no-evidence) genes.
  const catCount = useCallback(
    (gene: LocusGene) => evidenceMap.get(gene.gene_symbol)?.size ?? 0,
    [evidenceMap],
  );

  // Instance-count tiebreaker for the "#" rank — total evidence instances for
  // the gene. NOT a value sum: open values aren't comparable across categories/
  // sources (plan 2026-06-01-evidence-value-model). Keeps the heatmap rank in
  // step with the Traits-page rank (distinct categories, then instance count).
  const instanceCount = useCallback(
    (gene: LocusGene) => gene.evidence.length,
    [],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // "#" (category count) and category columns: most-evidence first (desc);
      // gene name: A→Z (asc).
      setSortDir(key === "gene" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...visibleGenes];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "#") {
        const c = catCount(a) - catCount(b);
        if (c !== 0) return c * dir;
        return (instanceCount(a) - instanceCount(b)) * dir;
      }
      if (sortKey === "gene") {
        return a.gene_symbol.localeCompare(b.gene_symbol) * dir;
      }
      // Category column: rank by instance count (scale-free), not a value max —
      // open values aren't comparable across sources/instances.
      const aEvs = evidenceMap.get(a.gene_symbol)?.get(sortKey);
      const bEvs = evidenceMap.get(b.gene_symbol)?.get(sortKey);
      return ((aEvs?.length ?? 0) - (bEvs?.length ?? 0)) * dir;
    });
    return arr;
  }, [visibleGenes, evidenceMap, sortKey, sortDir]);

  const popoverFor = (
    e: React.MouseEvent,
    gene: string,
    cat: string,
    items: LocusGeneEvidence[],
    pinned: boolean,
  ): PopoverState => {
    const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Viewport coordinates — the popover renders position:fixed so it escapes
    // the heatmap's overflow-x-auto container (which would otherwise clip it
    // when the loci list is short).
    return {
      gene,
      cat,
      items,
      catLabel: categories[cat] ?? cat,
      x: cellRect.left + cellRect.width / 2,
      y: cellRect.bottom + 4,
      pinned,
    };
  };

  // Click pins the popover (interactive); clicking the same pinned cell closes it.
  const handleCellClick = (
    e: React.MouseEvent,
    gene: string,
    cat: string,
    items: LocusGeneEvidence[],
  ) => {
    setPopover((prev) =>
      prev?.pinned && prev.gene === gene && prev.cat === cat
        ? null
        : popoverFor(e, gene, cat, items, true),
    );
  };

  // Hover shows a read-only popover, but never overrides a pinned one.
  const handleCellHover = (
    e: React.MouseEvent,
    gene: string,
    cat: string,
    items: LocusGeneEvidence[],
  ) => {
    const next = popoverFor(e, gene, cat, items, false);
    setPopover((prev) => (prev?.pinned ? prev : next));
  };
  const handleCellLeave = () => {
    setPopover((prev) => (prev?.pinned ? prev : null));
  };

  const toggleGene = useCallback((gene: string) => {
    setExpandedGenes((prev) => {
      const next = new Set(prev);
      if (next.has(gene)) next.delete(gene);
      else next.add(gene);
      return next;
    });
  }, []);

  const totalColSpan = categoryKeys.length + 2; // rank + gene + categories

  return (
    <div ref={containerRef} className="overflow-x-auto relative">
      {onEvidenceOnlyChange && (
        <label
          className="flex items-center gap-1.5 text-xs text-base-content/60 cursor-pointer mb-2 w-fit"
          title="Show only genes with gene-specific evidence — hides positional candidates and genes whose only signal is locus-wide (e.g. GWAS)."
        >
          <input
            type="checkbox"
            className="toggle toggle-xs"
            checked={evidenceOnly}
            onChange={(e) => onEvidenceOnlyChange(e.target.checked)}
          />
          Evidence only
          {evidenceOnly && hiddenCount > 0 && (
            <span className="text-base-content/40">
              ({hiddenCount} candidate{hiddenCount === 1 ? "" : "s"} hidden)
            </span>
          )}
        </label>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-base-content/40 py-2">
          {evidenceOnly && genes.length > 0
            ? "No genes with evidence at this locus — toggle off “Evidence only” to see positional candidates."
            : "No candidate genes at this locus."}
        </p>
      ) : (
      <table className="table table-xs">
        <thead>
          <tr>
            <th
              className="sticky left-0 bg-base-100 z-10 w-8 text-right align-bottom cursor-pointer select-none hover:text-base-content"
              onClick={() => handleSort("#")}
            >
              <span className="inline-flex items-center gap-0.5">
                #
                <SortIcon active={sortKey === "#"} dir={sortDir} />
              </span>
            </th>
            <th
              className="bg-base-100 align-bottom cursor-pointer select-none hover:text-base-content"
              onClick={() => handleSort("gene")}
            >
              <span className="inline-flex items-center gap-0.5">
                Gene
                <SortIcon active={sortKey === "gene"} dir={sortDir} />
              </span>
            </th>
            {categoryKeys.map((cat) => (
              <th
                key={cat}
                className="px-0 w-6 text-center align-bottom cursor-pointer select-none hover:text-base-content"
                title={categories[cat]}
                onClick={() => handleSort(cat)}
              >
                <div className="flex flex-col items-center gap-0.5">
                  {sortKey === cat && <SortIcon active dir={sortDir} />}
                  <span className={`[writing-mode:vertical-lr] text-[10px] rotate-180 leading-none ${sortKey === cat ? "font-bold" : ""}`}>
                    {cat}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((gene) => {
            const catMap = evidenceMap.get(gene.gene_symbol);
            // "#" column = live distinct-category count (0 → "-" for
            // candidate genes with no evidence).
            const n = catCount(gene);
            const rank = n > 0 ? n : null;
            const isExpanded = expandedGenes.has(gene.gene_symbol);

            return (
              <GeneRow
                key={gene.gene_symbol}
                gene={gene}
                rank={rank}
                catMap={catMap}
                categoryKeys={categoryKeys}
                categories={categories}
                isExpanded={isExpanded}
                onToggle={() => toggleGene(gene.gene_symbol)}
                onGeneClick={onGeneClick}
                onCellClick={handleCellClick}
                onCellHover={handleCellHover}
                onCellLeave={handleCellLeave}
                popover={popover}
                totalColSpan={totalColSpan}
              />
            );
          })}
        </tbody>
      </table>
      )}

      {/* Evidence popover */}
      {popover && (
        <div
          ref={popoverRef}
          className={`fixed z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 w-72 ${
            popover.pinned ? "" : "pointer-events-none"
          }`}
          style={{
            // Clamp to the viewport so a near-edge cell doesn't push it
            // off-screen (8px gutter; popover is w-72 = 288px).
            left: Math.max(8, Math.min(popover.x - 144, window.innerWidth - 288 - 8)),
            top: popover.y,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">
              {popover.gene} — {popover.catLabel}
            </span>
            <button
              className="text-base-content/40 hover:text-base-content text-xs"
              onClick={() => setPopover(null)}
            >
              ✕
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {popover.items.map((ev, i) => (
              <div key={i} className="text-xs border-t border-base-200 pt-1.5 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/sources?source=${encodeURIComponent(ev.source_tag)}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {ev.source_tag}
                  </Link>
                  {ev.match_type === "position" ? (
                    <span
                      className="badge badge-ghost badge-xs"
                      title="Variant evidence implicating the whole locus — fanned to every candidate gene, not specific to this gene."
                    >
                      locus-wide
                    </span>
                  ) : ev.match_type === "gene" ? (
                    <span
                      className="badge badge-ghost badge-xs"
                      title="Evidence mapped specifically to this gene."
                    >
                      gene-specific
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-base-content/60">
                  {ev.primary_value != null && String(ev.primary_value) !== "-" && (
                    <span>
                      {ev.primary_value_label ?? "value"} ={" "}
                      {formatScore(ev.primary_value)}
                    </span>
                  )}
                  {ev.secondary_value != null &&
                    String(ev.secondary_value) !== "-" && (
                      <span>
                        {ev.secondary_value_label ?? "secondary"} ={" "}
                        {formatScore(ev.secondary_value)}
                      </span>
                    )}
                  {ev.tissue && String(ev.tissue) !== "-" && (
                    <span>{ev.tissue}</span>
                  )}
                  {ev.cell_type && String(ev.cell_type) !== "-" && (
                    <span>{ev.cell_type}</span>
                  )}
                  {ev.ancestry && String(ev.ancestry) !== "-" && (
                    <span>{ev.ancestry}</span>
                  )}
                  {ev.sex && String(ev.sex) !== "-" && <span>{ev.sex}</span>}
                  {ev.detail && String(ev.detail) !== "-" && (
                    <span className="italic">{ev.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Gene row + expansion ---

function GeneRow({
  gene,
  rank,
  catMap,
  categoryKeys,
  categories,
  isExpanded,
  onToggle,
  onGeneClick,
  onCellClick,
  onCellHover,
  onCellLeave,
  popover,
  totalColSpan,
}: {
  gene: LocusGene;
  rank: number | null;
  catMap: Map<string, LocusGeneEvidence[]> | undefined;
  categoryKeys: string[];
  categories: Record<string, string>;
  isExpanded: boolean;
  onToggle: () => void;
  onGeneClick?: (gene: string) => void;
  onCellClick: (e: React.MouseEvent, gene: string, cat: string, items: LocusGeneEvidence[]) => void;
  onCellHover: (e: React.MouseEvent, gene: string, cat: string, items: LocusGeneEvidence[]) => void;
  onCellLeave: () => void;
  popover: PopoverState;
  totalColSpan: number;
}) {
  return (
    <>
      <tr className="hover cursor-pointer" onClick={onToggle}>
        <td className="sticky left-0 bg-base-100 z-10 text-right text-xs text-base-content/40 tabular-nums">
          {rank ?? "-"}
        </td>
        <td className="bg-base-100 font-medium">
          <span className="inline-flex items-center gap-1">
            {isExpanded
              ? <ChevronDown className="size-3 text-base-content/30" />
              : <ChevronRight className="size-3 text-base-content/30" />
            }
            <Link
              to={`/gene/${encodeURIComponent(gene.gene_symbol)}`}
              className="link link-primary"
              onClick={(e) => {
                e.stopPropagation();
                if (onGeneClick) {
                  e.preventDefault();
                  onGeneClick(gene.gene_symbol);
                }
              }}
            >
              {gene.gene_symbol}
            </Link>
            {gene.evidence.length > 1 && (
              <span className="text-[10px] text-base-content/30 tabular-nums">
                {gene.evidence.length}
              </span>
            )}
          </span>
        </td>
        {categoryKeys.map((cat) => {
          const items = catMap?.get(cat);
          if (!items || items.length === 0) {
            return (
              <td key={cat} className="px-0 w-6">
                <div className="flex justify-center">
                  <div className="w-4 h-4 border border-dashed border-base-300 rounded-sm" />
                </div>
              </td>
            );
          }

          // Shade by instance COUNT, not value: open values aren't comparable
          // across sources/categories (plan 2026-06-01-evidence-value-model).
          // 1 instance → light, 5+ → full. The actual values show on hover.
          const hue = categoryHue(cat);
          const opacity = 0.25 + Math.min((items.length - 1) / 4, 1) * 0.6;
          const isActive = popover?.gene === gene.gene_symbol && popover?.cat === cat;

          return (
            <td key={cat} className="px-0 w-6">
              <div className="flex justify-center">
                <div
                  className={`w-4 h-4 rounded-sm cursor-pointer hover:ring-2 hover:ring-primary/50 ${isActive ? "ring-2 ring-primary" : ""}`}
                  style={{
                    backgroundColor: `hsla(${hue}, 70%, 50%, ${opacity})`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCellClick(e, gene.gene_symbol, cat, items);
                  }}
                  onMouseEnter={(e) =>
                    onCellHover(e, gene.gene_symbol, cat, items)
                  }
                  onMouseLeave={onCellLeave}
                />
              </div>
            </td>
          );
        })}
      </tr>

      {/* Expanded evidence detail */}
      {isExpanded && (
        <tr>
          <td colSpan={totalColSpan} className="bg-base-200/30 px-4 py-2">
            <EvidenceDetailTable
              evidence={gene.evidence}
              categories={categories}
              categoryKeys={categoryKeys}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Evidence detail table (shown inside expanded row) ---

function EvidenceDetailTable({
  evidence,
  categories,
  categoryKeys,
}: {
  evidence: LocusGeneEvidence[];
  categories: Record<string, string>;
  categoryKeys: string[];
}) {
  // Determine which context columns have data across all evidence
  const hasField = (field: keyof LocusGeneEvidence) =>
    evidence.some((ev) => {
      const v = ev[field];
      return v != null && String(v) !== "" && String(v) !== "-";
    });

  const hasTissue = hasField("tissue");
  const hasCellType = hasField("cell_type");
  const hasAncestry = hasField("ancestry");
  const hasSex = hasField("sex");
  const hasSecondary = hasField("secondary_value");

  // Group by category, preserving heatmap column order
  const grouped = useMemo(() => {
    const byCategory = new Map<string, LocusGeneEvidence[]>();
    for (const ev of evidence) {
      const cat = ev.evidence_category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(ev);
    }
    // Return in column order, only categories that have evidence
    return categoryKeys
      .filter((k) => byCategory.has(k))
      .map((k) => ({
        key: k,
        label: categories[k] ?? k,
        items: byCategory.get(k)!.sort((a, b) =>
          (a.source_tag ?? "").localeCompare(b.source_tag ?? ""),
        ),
      }));
  }, [evidence, categories, categoryKeys]);

  // Count context columns for colSpan on section headers
  const contextColCount =
    1 // source (always shown)
    + (hasTissue ? 1 : 0)
    + (hasCellType ? 1 : 0)
    + (hasAncestry ? 1 : 0)
    + (hasSex ? 1 : 0)
    + 1 // primary value (always shown)
    + (hasSecondary ? 1 : 0);

  const fmtVal = (v: unknown) => {
    if (v == null || String(v) === "-" || String(v) === "") return null;
    return String(v);
  };

  return (
    <table className="table table-xs w-full">
      <thead>
        <tr className="text-base-content/40">
          <th className="font-medium">source</th>
          {hasTissue && <th className="font-medium">tissue</th>}
          {hasCellType && <th className="font-medium">cell type</th>}
          {hasAncestry && <th className="font-medium">ancestry</th>}
          {hasSex && <th className="font-medium">sex</th>}
          <th className="font-medium">value</th>
          {hasSecondary && <th className="font-medium">secondary</th>}
        </tr>
      </thead>
      <tbody>
        {grouped.map(({ key, label, items }) => {
          const hue = categoryHue(key);
          // Value labels for this category (per-mapping; uniform within a group
          // in practice — take the first instance's).
          const lbls = [
            items[0]?.primary_value_label,
            items[0]?.secondary_value_label,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Fragment key={key}>
              <tr>
                <td colSpan={contextColCount} className="pt-2 pb-0.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: `hsla(${hue}, 70%, 50%, 0.7)` }}
                    />
                    <span className="font-medium text-xs">{key}</span>
                    <span className="text-base-content/40 text-xs">{label}</span>
                    {lbls && (
                      <span className="text-base-content/30 text-xs">({lbls})</span>
                    )}
                  </span>
                </td>
              </tr>
              {items.map((ev, i) => (
                <tr key={i}>
                  <td className="pl-6">
                    <Link
                      to={`/sources?source=${encodeURIComponent(ev.source_tag)}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {ev.source_tag}
                    </Link>
                  </td>
                  {hasTissue && <td className="text-base-content/60">{fmtVal(ev.tissue) ?? "—"}</td>}
                  {hasCellType && <td className="text-base-content/60">{fmtVal(ev.cell_type) ?? "—"}</td>}
                  {hasAncestry && <td className="text-base-content/60">{fmtVal(ev.ancestry) ?? "—"}</td>}
                  {hasSex && <td className="text-base-content/60">{fmtVal(ev.sex) ?? "—"}</td>}
                  <td className="tabular-nums">
                    {ev.primary_value != null && String(ev.primary_value) !== "-"
                      ? formatScore(ev.primary_value)
                      : "—"}
                  </td>
                  {hasSecondary && (
                    <td className="tabular-nums text-base-content/60">
                      {ev.secondary_value != null &&
                      String(ev.secondary_value) !== "-"
                        ? formatScore(ev.secondary_value)
                        : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === "asc"
    ? <ArrowUpNarrowWide size={12} className="inline opacity-60" />
    : <ArrowDownWideNarrow size={12} className="inline opacity-60" />;
}
