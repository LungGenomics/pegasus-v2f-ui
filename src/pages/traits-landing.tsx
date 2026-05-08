import { useState } from "react";
import { Link } from "react-router";
import { useDbStatus } from "../api/db";
import { useStudies } from "../api/studies";
import { useGeneSearch } from "../api/genes";
import { useTraitGroups } from "../api/traits";
import { SearchInput } from "../components/search-input";
import { Loading, ErrorAlert } from "../components/loading";
import { formatNumber } from "../lib/format";

export function TraitsLandingPage() {
  const { data: status } = useDbStatus();
  const studiesQ = useStudies();
  const traitGroupsQ = useTraitGroups();
  const [search, setSearch] = useState("");
  const geneSearch = useGeneSearch(search);

  const totalLoci = traitGroupsQ.data?.reduce((sum, g) => sum + g.totalLoci, 0) ?? 0;
  const totalTraits = traitGroupsQ.data?.length ?? 0;
  const totalStudies = studiesQ.data?.length ?? 0;

  if (traitGroupsQ.isLoading) return <Loading />;
  if (traitGroupsQ.error)
    return <ErrorAlert message={traitGroupsQ.error.message} />;

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center text-center px-4 pt-20 pb-16">
        <h1 className="font-thin text-primary text-6xl mb-4 tracking-wide">PEGASUS</h1>
        <p className="text-base text-base-content/50 max-w-2xl mb-12">
          Variant-to-function database for lung function gene prioritization.
        </p>

        {/* Gene search */}
        <div className="w-full max-w-xl relative">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by gene symbol or name..."
          />
          {search.trim() && geneSearch.data && geneSearch.data.results.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 bg-base-100 rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-base-200">
              {geneSearch.data.results.slice(0, 10).map((g) => (
                <li key={g.ensembl_gene_id}>
                  <Link
                    to={`/genes/${encodeURIComponent(g.gene)}`}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-base-200 transition-colors"
                  >
                    <span className="font-mono font-semibold">{g.gene}</span>
                    {g.ensembl_gene_id && (
                      <span className="text-xs text-base-content/40">
                        {g.ensembl_gene_id}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-12 text-sm text-base-content/50">
          <span><strong className="text-primary">{totalTraits}</strong> traits</span>
          <span className="text-base-content/20">·</span>
          <span><strong className="text-secondary">{totalStudies}</strong> studies</span>
          <span className="text-base-content/20">·</span>
          <span><strong className="text-accent">{formatNumber(totalLoci)}</strong> loci</span>
          {status?.genome_build && status.genome_build !== "-" && (
            <>
              <span className="text-base-content/20">·</span>
              <span>{status.genome_build}</span>
            </>
          )}
        </div>
      </div>

      {/* Trait cards */}
      <div className="max-w-4xl mx-auto w-full px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {traitGroupsQ.data?.map((group) => (
            <Link
              key={group.trait}
              to={`/traits/${encodeURIComponent(group.trait)}`}
              className="bg-base-100 border border-base-300 rounded-lg p-4 hover:border-primary/40 transition-colors"
            >
              <div className="font-medium">{group.trait}</div>
              {group.traitDescription && (
                <div className="text-xs text-base-content/40 mt-1 line-clamp-1">
                  {group.traitDescription}
                </div>
              )}
              <div className="text-xs text-base-content/40 mt-2">
                {group.studies.length} {group.studies.length === 1 ? "study" : "studies"} · {group.totalLoci} loci
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      {status && status.package_version !== "-" && (
        <div className="text-center text-xs text-base-content/30 pb-6">
          v{status.package_version}
        </div>
      )}
    </div>
  );
}
