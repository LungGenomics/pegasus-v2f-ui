import { Fragment, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { ArrowUpNarrowWide, ArrowDownWideNarrow, ChevronRight, ChevronDown } from "lucide-react";
import type { LocusGene, LocusGeneEvidence } from "../../api/types";
import { formatPvalue, formatScore } from "../../lib/format";

type Props = {
  genes: LocusGene[];
  categories: Record<string, string>; // abbreviation -> full name
  onGeneClick?: (gene: string) => void;
};

/** Map category abbreviation to a hue for the heatmap cell fill. Exported so
 *  the landing-page category glossary can show matching color dots. */
export const CATEGORY_HUES: Record<string, string> = {
  QTL: "217",   // blue
  COLOC: "217",
  GWAS: "271",  // purple
  PROX: "160",  // teal
  CODE: "0",    // red
  RARE: "0",
  EXP: "199",   // cyan
  EPIG: "199",
  CHROM: "199",
  REG: "38",    // amber
  FUNC: "142",  // green
  MOD: "142",
  DRUG: "38",
  PATH: "160",
  PPI: "160",
  KNOW: "220",  // neutral blue
  LIT: "220",
  CLIN: "0",
  OMICS: "217",
  PERT: "142",
  EVOL: "220",
  OTHER: "0",
};

type PopoverState = {
  gene: string;
  cat: string;
  items: LocusGeneEvidence[];
  catLabel: string;
  x: number;
  y: number;
} | null;

type SortKey = "#" | "gene" | string;
type SortDir = "asc" | "desc";

export function EvidenceHeatmap({ genes, categories, onGeneClick }: Props) {
  const categoryKeys = Object.keys(categories);
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
    for (const gene of genes) {
      const catMap = new Map<string, LocusGeneEvidence[]>();
      for (const ev of gene.evidence) {
        const cat = ev.evidence_category;
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat)!.push(ev);
      }
      map.set(gene.gene_symbol, catMap);
    }
    return map;
  }, [genes]);

  // Live replacement for the dropped integration_rank: a gene's distinct
  // evidence-category count (the old "gene score" was exactly this). Drives
  // the "#" column + its default sort. 0 for candidate (no-evidence) genes.
  const catCount = useCallback(
    (gene: LocusGene) => evidenceMap.get(gene.gene_symbol)?.size ?? 0,
    [evidenceMap],
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
    const arr = [...genes];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "#") {
        return (catCount(a) - catCount(b)) * dir;
      }
      if (sortKey === "gene") {
        return a.gene_symbol.localeCompare(b.gene_symbol) * dir;
      }
      const aEvs = evidenceMap.get(a.gene_symbol)?.get(sortKey);
      const bEvs = evidenceMap.get(b.gene_symbol)?.get(sortKey);
      const aMax = aEvs ? Math.max(...aEvs.map((e) => typeof e.score === "number" ? e.score : parseFloat(String(e.score ?? "")) || 0)) : 0;
      const bMax = bEvs ? Math.max(...bEvs.map((e) => typeof e.score === "number" ? e.score : parseFloat(String(e.score ?? "")) || 0)) : 0;
      if (aMax !== bMax) return (aMax - bMax) * dir;
      return ((aEvs?.length ?? 0) - (bEvs?.length ?? 0)) * dir;
    });
    return arr;
  }, [genes, evidenceMap, sortKey, sortDir]);

  const handleCellClick = (
    e: React.MouseEvent,
    gene: string,
    cat: string,
    items: LocusGeneEvidence[],
  ) => {
    if (popover?.gene === gene && popover?.cat === cat) {
      setPopover(null);
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    setPopover({
      gene,
      cat,
      items,
      catLabel: categories[cat] ?? cat,
      x: cellRect.left - containerRect.left + cellRect.width / 2,
      y: cellRect.bottom - containerRect.top + 4,
    });
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
                popover={popover}
                totalColSpan={totalColSpan}
              />
            );
          })}
        </tbody>
      </table>

      {/* Evidence popover */}
      {popover && (
        <div
          ref={popoverRef}
          className="absolute z-20 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 w-72"
          style={{
            left: Math.min(popover.x - 144, (containerRef.current?.scrollWidth ?? 300) - 288),
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
                  {ev.evidence_stream && ev.evidence_stream !== "-" && (
                    <span className="text-base-content/40">{ev.evidence_stream}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-base-content/60">
                  {ev.pvalue && String(ev.pvalue) !== "-" && (
                    <span>p = {formatPvalue(ev.pvalue)}</span>
                  )}
                  {ev.score && String(ev.score) !== "-" && (
                    <span>score = {formatScore(ev.score)}</span>
                  )}
                  {ev.tissue && String(ev.tissue) !== "-" && (
                    <span>{ev.tissue}</span>
                  )}
                  {ev.cell_type && String(ev.cell_type) !== "-" && (
                    <span>{ev.cell_type}</span>
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
              to={`/explore/gene/${encodeURIComponent(gene.gene_symbol)}`}
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

          const maxScore = Math.max(
            ...items.map((e) =>
              typeof e.score === "number"
                ? e.score
                : parseFloat(String(e.score)) || 0,
            ),
          );
          const hue = CATEGORY_HUES[cat] ?? "0";
          const opacity = 0.2 + Math.min(maxScore, 1) * 0.7;
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
  const hasPvalue = hasField("pvalue");
  const hasEffectSize = hasField("effect_size");

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
    + (hasPvalue ? 1 : 0)
    + (hasEffectSize ? 1 : 0)
    + 1; // score (always shown)

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
          {hasPvalue && <th className="font-medium">p-value</th>}
          {hasEffectSize && <th className="font-medium">effect</th>}
          <th className="font-medium">score</th>
        </tr>
      </thead>
      <tbody>
        {grouped.map(({ key, label, items }) => {
          const hue = CATEGORY_HUES[key] ?? "0";
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
                  {hasPvalue && (
                    <td className="tabular-nums text-base-content/60">
                      {ev.pvalue && String(ev.pvalue) !== "-" ? formatPvalue(ev.pvalue) : "—"}
                    </td>
                  )}
                  {hasEffectSize && (
                    <td className="tabular-nums text-base-content/60">
                      {ev.effect_size && String(ev.effect_size) !== "-" ? formatScore(ev.effect_size) : "—"}
                    </td>
                  )}
                  <td className="tabular-nums">
                    {ev.score && String(ev.score) !== "-" ? formatScore(ev.score) : "—"}
                  </td>
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
