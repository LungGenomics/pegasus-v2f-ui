// Gene detail page. Header (symbol + Ensembl id + coords + biotype), the loci
// implicating this gene and the traits it has evidence for (linked lists,
// traverse one hop), and a flat evidence table across all its loci.

import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getGene,
  geneLoci,
  geneTraits,
  geneEvidence,
} from "../../data/queries/explore";
import { formatCoordinate, formatPvalue, formatScore } from "../../lib/format";
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
      <Breadcrumb name={symbol} />
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

      {/* Evidence */}
      <h2 className="text-sm font-medium text-base-content/60 mt-6 mb-2">
        Evidence ({evidence.length})
      </h2>
      {evidence.length === 0 ? (
        <p className="text-xs text-base-content/40">No evidence rows.</p>
      ) : (
        <div className="border border-base-300 rounded-lg overflow-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Category</th>
                <th>Trait</th>
                <th>Source</th>
                <th className="text-right">p</th>
                <th className="text-right">effect</th>
                <th className="text-right">score</th>
                <th>tissue</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e, i) => (
                <tr key={i}>
                  <td className="font-mono">{e.evidence_category}</td>
                  <td>{e.trait_label ?? ""}</td>
                  <td className="font-mono text-base-content/60">{e.source_tag}</td>
                  <td className="text-right tabular-nums">
                    {e.pvalue != null && String(e.pvalue) !== "-"
                      ? formatPvalue(e.pvalue)
                      : ""}
                  </td>
                  <td className="text-right tabular-nums">
                    {e.effect_size != null && String(e.effect_size) !== "-"
                      ? formatScore(e.effect_size)
                      : ""}
                  </td>
                  <td className="text-right tabular-nums">
                    {e.score != null && String(e.score) !== "-"
                      ? formatScore(e.score)
                      : ""}
                  </td>
                  <td className="text-base-content/60">{e.tissue ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
