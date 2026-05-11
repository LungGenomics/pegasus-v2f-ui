import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useGene, useGeneEvidence, useGeneScores } from "../api/genes";
import { PageHeader } from "../components/layout/page-header";
import { Loading, ErrorAlert } from "../components/loading";
import { formatCoordinate } from "../lib/format";
import type { GeneScore } from "../api/types";

export function GeneDetailPage() {
  const { gene } = useParams<{ gene: string }>();
  const geneQ = useGene(gene ?? "");
  const scoresQ = useGeneScores(gene ?? "");
  const evidenceQ = useGeneEvidence(gene ?? "");

  // Group scores by study
  const studyGroups = useMemo(() => {
    if (!scoresQ.data?.length) return [];
    const map = new Map<string, { studyId: string; trait: string; loci: GeneScore[] }>();
    for (const s of scoresQ.data) {
      const key = s.study_id;
      if (!map.has(key)) {
        map.set(key, { studyId: s.study_id, trait: s.trait ?? s.study_id, loci: [] });
      }
      map.get(key)!.loci.push(s);
    }
    // Sort loci within each study by rank
    for (const group of map.values()) {
      group.loci.sort((a, b) => (Number(a.integration_rank) || 999) - (Number(b.integration_rank) || 999));
    }
    return [...map.values()];
  }, [scoresQ.data]);

  // Aggregate evidence by source
  const sourceSummary = useMemo(() => {
    if (!evidenceQ.data?.length) return [];
    const map = new Map<string, { sourceTag: string; categories: Set<string>; traits: Set<string>; count: number }>();
    for (const ev of evidenceQ.data) {
      const key = ev.source_tag;
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, { sourceTag: key, categories: new Set(), traits: new Set(), count: 0 });
      }
      const entry = map.get(key)!;
      if (ev.evidence_category) entry.categories.add(ev.evidence_category);
      if (ev.trait) entry.traits.add(ev.trait);
      entry.count++;
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [evidenceQ.data]);

  const nStudies = studyGroups.length;
  const nLoci = scoresQ.data?.length ?? 0;
  const hasScores = nLoci > 0;
  const multiStudy = nStudies > 1;

  if (geneQ.isLoading) return <Loading />;
  if (geneQ.error) return <ErrorAlert message={geneQ.error.message} />;
  if (!geneQ.data) return null;

  const g = geneQ.data;

  return (
    <div>
      <PageHeader
        title={g.gene_symbol}
        description={g.gene_name}
        breadcrumbs={[
          { label: "Genes", to: "/genes" },
          { label: g.gene_symbol },
        ]}
      />

      {/* Metadata badges */}
      <div className="flex flex-wrap gap-3 mb-6 text-sm">
        <span className="badge badge-outline">{g.ensembl_gene_id}</span>
        {g.chromosome && (
          <span className="badge badge-outline">
            {formatCoordinate(g.chromosome, g.start_position, g.end_position)}
          </span>
        )}
        {g.strand && (
          <span className="badge badge-outline">Strand: {g.strand}</span>
        )}
      </div>

      {scoresQ.isLoading ? (
        <Loading text="Loading scores..." />
      ) : hasScores ? (
        <>
          {/* Study-grouped locus list */}
          <section className="mb-8">
            <h2 className="text-sm font-medium text-base-content/60 mb-3">
              Locus Appearances
              <span className="font-normal ml-1">
                (in {nStudies} trait{nStudies !== 1 ? "s" : ""} across {nLoci} loc{nLoci !== 1 ? "i" : "us"})
              </span>
            </h2>
            <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
              {studyGroups.map((group) => (
                <div key={group.studyId}>
                  {/* Study header (only if multi-study) */}
                  {multiStudy && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 border-b border-base-300">
                      <span className="text-sm font-medium">{group.trait}</span>
                      <span className="text-xs text-base-content/40">{group.studyId}</span>
                    </div>
                  )}
                  {/* Locus rows */}
                  {group.loci.map((locus) => (
                    <div
                      key={locus.locus_id}
                      className="flex items-center gap-3 px-4 py-2 border-b border-base-300 last:border-b-0 hover:bg-base-200/30 transition-colors"
                    >
                      <Link
                        to={`/traits/${encodeURIComponent(group.trait)}?locus=${encodeURIComponent(locus.locus_id)}`}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {locus.locus_name}
                      </Link>
                      <span className="text-xs text-base-content/50">
                        {formatCoordinate(locus.chromosome, locus.start_position, locus.end_position)}
                      </span>
                      <span className="ml-auto text-xs text-base-content/40 tabular-nums">
                        #{Number(locus.integration_rank)} of {Number(locus.n_candidate_genes)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* Source support */}
          {evidenceQ.isLoading ? (
            <Loading text="Loading evidence..." />
          ) : sourceSummary.length > 0 ? (
            <section className="mb-8">
              <h2 className="text-sm font-medium text-base-content/60 mb-3">Supporting Sources</h2>
              <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-base-content/50">
                      <th>Source</th>
                      <th>Category</th>
                      <th>Traits</th>
                      <th className="text-right">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceSummary.map((src) => (
                      <tr key={src.sourceTag} className="hover">
                        <td className="font-mono text-xs">
                          <Link
                            to={`/sources?source=${encodeURIComponent(src.sourceTag)}&from=gene&fromId=${encodeURIComponent(g.gene_symbol)}`}
                            className="text-primary hover:underline"
                          >
                            {src.sourceTag}
                          </Link>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {[...src.categories].sort().map((cat) => (
                              <span key={cat} className="badge badge-xs badge-outline text-[10px]">
                                {cat}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {[...src.traits].sort().map((t) => (
                              <span key={t} className="text-xs text-base-content/60">{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right text-xs tabular-nums">{src.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="text-center py-12 text-base-content/40 text-sm">
          This gene does not appear in any PEGASUS study.
        </div>
      )}
    </div>
  );
}
