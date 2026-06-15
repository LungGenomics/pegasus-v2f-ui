// Gene detail page. Header (symbol + Ensembl id + coords + biotype), the loci
// implicating this gene and the traits it has evidence for (linked lists,
// traverse one hop), and the evidence grouped by PEGASUS category (count =
// summary; instances with their values + attributes on expand).

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import {
  getGene,
  geneLoci,
  geneTraits,
  geneEvidence,
  type GeneEvidenceRow,
} from "../../data/queries/explore";
import { EVIDENCE_CATEGORIES } from "../../data/static";
import { CATEGORY_HUES } from "../../components/locus-detail-pane/evidence-heatmap";
import { formatCoordinate, formatScore } from "../../lib/format";
import { Breadcrumb } from "./breadcrumb";

export function GeneDetailPage() {
  const { symbol: rawSym } = useParams<{ symbol: string }>();
  const symbol = rawSym ? decodeURIComponent(rawSym) : "";

  const geneQ = useQuery({
    queryKey: ["explore", "gene", symbol],
    queryFn: () => getGene(symbol),
    enabled: !!symbol,
  });
  const lociQ = useQuery({
    queryKey: ["explore", "gene-loci", symbol],
    queryFn: () => geneLoci(symbol),
    enabled: !!symbol,
  });
  const traitsQ = useQuery({
    queryKey: ["explore", "gene-traits", symbol],
    queryFn: () => geneTraits(symbol),
    enabled: !!symbol,
  });
  const evQ = useQuery({
    queryKey: ["explore", "gene-evidence", symbol],
    queryFn: () => geneEvidence(symbol),
    enabled: !!symbol,
  });

  const gene = geneQ.data;
  const loci = lociQ.data ?? [];
  const traits = traitsQ.data ?? [];
  const evidence = evQ.data ?? [];

  return (
    <div className="h-full overflow-auto">
      <Breadcrumb kind="Gene" name={symbol} />
      <h1 className="text-lg font-semibold font-mono mt-2">{symbol}</h1>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60 mt-1">
        {gene?.ensembl_gene_id && <span className="font-mono">{gene.ensembl_gene_id}</span>}
        {gene?.chromosome && gene.start != null && gene.end != null && (
          <span className="font-mono">
            {formatCoordinate(gene.chromosome, gene.start, gene.end)}
          </span>
        )}
        {gene?.strand && <span>strand {gene.strand}</span>}
        {gene?.gene_type && <span>{gene.gene_type}</span>}
        {!gene && !geneQ.isLoading && (
          <span className="italic">not in the gene reference</span>
        )}
      </div>

      {/* Loci */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Loci ({loci.length})
      </h2>
      {loci.length === 0 ? (
        <p className="text-xs text-base-content/40">Not implicated at any locus.</p>
      ) : (
        <div className="border border-base-300 rounded-md divide-y divide-base-300">
          {loci.map((l) => (
            <Link
              key={l.locus_id}
              to={`/locus/${encodeURIComponent(l.locus_id)}`}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-base-200/50"
            >
              <span className="font-mono font-medium flex-1 min-w-0 truncate">
                {l.locus_name || l.locus_id}
              </span>
              <span className="text-xs text-base-content/40 hidden sm:inline">
                {formatCoordinate(
                  l.chromosome ?? "",
                  l.start_position ?? 0,
                  l.end_position ?? 0,
                )}
              </span>
              {l.source_tag && (
                <span className="text-xs text-base-content/40 font-mono">
                  {l.source_tag}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Traits */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Traits ({traits.length})
      </h2>
      {traits.length === 0 ? (
        <p className="text-xs text-base-content/40">No trait evidence.</p>
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
                {t.n_evidence} evidence
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Evidence — grouped by PEGASUS category */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Evidence
      </h2>
      <GeneEvidence rows={evidence} />
    </div>
  );
}

// Evidence by category: each category is a summary row (instance count); expand
// to list its instances with their open values (labeled) + attributes. The
// count is the summary — open values aren't aggregated across categories (they
// aren't comparable), so they appear only per-instance here.
function GeneEvidence({ rows }: { rows: GeneEvidenceRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const byCat = new Map<string, GeneEvidenceRow[]>();
    for (const r of rows) {
      const c = r.evidence_category ?? "—";
      (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(r);
    }
    const order = Object.keys(EVIDENCE_CATEGORIES);
    return [...byCat.entries()].sort((a, b) => {
      const d = b[1].length - a[1].length; // most evidence first
      if (d !== 0) return d;
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    });
  }, [rows]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [cat, items] of groups) m.set(cat, items.length);
    return m;
  }, [groups]);

  if (rows.length === 0) {
    return <p className="text-xs text-base-content/40">No evidence.</p>;
  }

  const toggle = (cat: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  // From the heatmap strip: open the category and scroll its row into view.
  const openAndScroll = (cat: string) => {
    setOpen((prev) => new Set(prev).add(cat));
    requestAnimationFrame(() =>
      document
        .getElementById(`evcat-${cat}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  return (
    <>
      <CategoryHeatStrip counts={counts} onPick={openAndScroll} />
      <div className="border border-base-300 rounded-lg overflow-hidden divide-y divide-base-300">
        {groups.map(([cat, items]) => {
          const isOpen = open.has(cat);
          return (
            <div key={cat} id={`evcat-${cat}`} className="scroll-mt-2">
              <button
                type="button"
                onClick={() => toggle(cat)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200/50"
              >
              <ChevronRight
                className={`size-3.5 text-base-content/40 transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
              <span className="font-mono text-sm font-medium w-24 shrink-0">
                {cat}
              </span>
              <span className="text-sm text-base-content/60 flex-1 min-w-0 truncate">
                {EVIDENCE_CATEGORIES[cat] ?? cat}
              </span>
              <span className="text-xs text-base-content/40 tabular-nums shrink-0">
                {items.length} {items.length === 1 ? "instance" : "instances"}
              </span>
              </button>
              {isOpen && <GeneCategoryInstances items={items} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// A row of category squares for the gene (the per-gene evidence matrix spine),
// shaded by instance count. Clicking a populated square opens + scrolls to that
// category's row below. Empty categories are dashed and inert.
function CategoryHeatStrip({
  counts,
  onPick,
}: {
  counts: Map<string, number>;
  onPick: (cat: string) => void;
}) {
  return (
    <div className="flex justify-center mb-3 overflow-x-auto">
      <div className="flex items-end gap-1">
          {Object.keys(EVIDENCE_CATEGORIES).map((cat) => {
            const n = counts.get(cat) ?? 0;
            const has = n > 0;
            const hue = CATEGORY_HUES[cat] ?? "220";
            const opacity = 0.25 + Math.min((n - 1) / 4, 1) * 0.6;
            return (
              <div key={cat} className="flex flex-col items-center gap-1">
                <span
                  className={`[writing-mode:vertical-lr] rotate-180 text-[9px] leading-none font-mono ${
                    has ? "text-base-content/60" : "text-base-content/25"
                  }`}
                >
                  {cat}
                </span>
                <button
                  type="button"
                  disabled={!has}
                  onClick={() => onPick(cat)}
                  title={`${cat} · ${EVIDENCE_CATEGORIES[cat] ?? ""}${
                    has
                      ? ` · ${n} instance${n === 1 ? "" : "s"}`
                      : " · no evidence"
                  }`}
                  className={`w-5 h-5 rounded-sm shrink-0 ${
                    has
                      ? "cursor-pointer hover:ring-2 hover:ring-primary/50"
                      : "cursor-default"
                  }`}
                  style={{
                    backgroundColor: has
                      ? `hsl(${hue} 70% 50% / ${opacity})`
                      : "transparent",
                    border: has ? "none" : "1px dashed var(--color-base-300)",
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

// The instances within one category, with their (labeled) values + attributes.
// Value labels are per-mapping but uniform within a category in practice, so
// they head the value columns (from the first instance).
function GeneCategoryInstances({ items }: { items: GeneEvidenceRow[] }) {
  const primaryLabel = items[0]?.primary_value_label ?? "value";
  const secondaryLabel = items[0]?.secondary_value_label ?? "secondary";
  const hasSecondary = items.some(
    (r) => r.secondary_value != null && String(r.secondary_value) !== "-",
  );
  const ctx = (r: GeneEvidenceRow) =>
    [r.tissue, r.cell_type, r.ancestry, r.sex, r.detail]
      .filter((v) => v != null && String(v) !== "" && String(v) !== "-")
      .join(" / ");
  const fmt = (v: number | string | null) =>
    v != null && String(v) !== "-" ? formatScore(v) : "—";

  return (
    <div className="px-3 pb-2 overflow-auto">
      <table className="table table-xs">
        <thead>
          <tr className="text-base-content/40">
            <th className="font-medium">Trait</th>
            <th className="font-medium">Source</th>
            <th className="font-medium text-right">{primaryLabel}</th>
            {hasSecondary && (
              <th className="font-medium text-right">{secondaryLabel}</th>
            )}
            <th className="font-medium">Context</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i}>
              <td>{r.trait_label ?? ""}</td>
              <td className="font-mono text-base-content/60">{r.source_tag}</td>
              <td className="text-right tabular-nums">{fmt(r.primary_value)}</td>
              {hasSecondary && (
                <td className="text-right tabular-nums text-base-content/60">
                  {fmt(r.secondary_value)}
                </td>
              )}
              <td className="text-base-content/60">{ctx(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
