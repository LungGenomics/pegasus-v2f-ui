import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useGeneSearch, useScoredGenes } from "../api/genes";
import { SearchInput } from "../components/search-input";
import { PageHeader } from "../components/layout/page-header";
import { Loading, ErrorAlert } from "../components/loading";
import type { GeneSearchResult } from "../api/types";

const PAGE_SIZE = 50;

export function GenesPage() {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const searchPage = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(initialQ);
  const [browsePage, setBrowsePage] = useState(1);

  const searchOffset = (searchPage - 1) * PAGE_SIZE;
  const browseOffset = (browsePage - 1) * PAGE_SIZE;

  const searchQ = useGeneSearch(search, searchOffset);
  const scoredQ = useScoredGenes(browseOffset);

  function handleSearch(v: string) {
    setSearch(v);
    setParams(v ? { q: v } : {}, { replace: true });
  }

  function setSearchPage(p: number) {
    const next: Record<string, string> = {};
    if (search) next.q = search;
    if (p > 1) next.page = String(p);
    setParams(next, { replace: true });
  }

  const searchTotal = searchQ.data?.total ?? 0;
  const searchTotalPages = Math.ceil(searchTotal / PAGE_SIZE);
  const browseTotal = scoredQ.data?.total ?? 0;
  const browseTotalPages = Math.ceil(browseTotal / PAGE_SIZE);

  return (
    <div>
      <PageHeader title="Genes" />

      <div className="mb-6">
        <SearchInput
          value={search}
          onChange={handleSearch}
          placeholder="Search by gene symbol or name..."
        />
      </div>

      {/* Search results (only when searching) */}
      {search && (
        <div className="mb-8">
          {searchQ.isLoading && <Loading />}
          {searchQ.error && <ErrorAlert message={searchQ.error.message} />}
          {searchQ.data && (
            <>
              <p className="text-xs text-base-content/40 mb-3">
                {searchTotal.toLocaleString()} result{searchTotal !== 1 && "s"} matching &ldquo;{search}&rdquo;
              </p>
              <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
                <table className="table table-sm">
                  <thead>
                    <tr className="text-base-content/50">
                      <th>Gene</th>
                      <th>Ensembl ID</th>
                      <th>Chr</th>
                      <th className="text-right">Loci</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchQ.data.results.map((g: GeneSearchResult) => {
                      const hasData = Number(g.n_loci) > 0;
                      return (
                        <tr key={g.gene} className={hasData ? "hover" : "opacity-50"}>
                          <td>
                            <Link
                              to={`/genes/${encodeURIComponent(g.gene)}`}
                              className="font-mono font-semibold text-primary hover:underline"
                            >
                              {g.gene}
                            </Link>
                          </td>
                          <td className="text-xs text-base-content/50">
                            {g.ensembl_gene_id !== "-" ? g.ensembl_gene_id : ""}
                          </td>
                          <td className="text-xs text-base-content/60">
                            {g.chromosome && String(g.chromosome) !== "-" ? String(g.chromosome) : ""}
                          </td>
                          <td className="text-right text-xs tabular-nums">
                            {hasData ? Number(g.n_loci) : ""}
                          </td>
                          <td>
                            {hasData && g.evidence_categories && String(g.evidence_categories) !== "-" ? (
                              <CategoryBadges categories={String(g.evidence_categories)} />
                            ) : (
                              <span className="text-xs text-base-content/30">no data</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {searchQ.data.results.length === 0 && (
                <div className="text-center py-8 text-base-content/40 text-sm">
                  No genes found
                </div>
              )}
              {searchTotalPages > 1 && (
                <Pagination page={searchPage} totalPages={searchTotalPages} onPageChange={setSearchPage} />
              )}
            </>
          )}
        </div>
      )}

      {/* Scored genes table (always visible) */}
      <div>
        <h2 className="text-sm font-medium text-base-content/60 mb-3">
          Scored Genes
          {scoredQ.data && (
            <span className="ml-2 text-base-content/40">{browseTotal.toLocaleString()}</span>
          )}
        </h2>

        {scoredQ.isLoading && <Loading />}
        {scoredQ.error && <ErrorAlert message={scoredQ.error.message} />}
        {scoredQ.data && (
          <>
            <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
              <table className="table table-sm">
                <thead>
                  <tr className="text-base-content/50">
                    <th>Gene</th>
                    <th className="text-right">Traits</th>
                    <th className="text-right">Loci</th>
                    <th className="text-right">Best Rank</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {scoredQ.data.results.map((g: GeneSearchResult) => (
                    <tr key={g.gene} className="hover">
                      <td>
                        <Link
                          to={`/genes/${encodeURIComponent(g.gene)}`}
                          className="font-mono font-semibold text-primary hover:underline"
                        >
                          {g.gene}
                        </Link>
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {Number(g.n_studies) || ""}
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {Number(g.n_loci) || ""}
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {Number(g.best_rank) || ""}
                      </td>
                      <td>
                        {g.evidence_categories && String(g.evidence_categories) !== "-" ? (
                          <CategoryBadges categories={String(g.evidence_categories)} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scoredQ.data.results.length === 0 && (
              <div className="text-center py-8 text-base-content/40 text-sm">
                No scored genes
              </div>
            )}
            {browseTotalPages > 1 && (
              <Pagination page={browsePage} totalPages={browseTotalPages} onPageChange={setBrowsePage} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CategoryBadges({ categories }: { categories: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {categories.split(", ").map((cat) => (
        <span key={cat} className="badge badge-xs badge-outline text-[10px]">
          {cat}
        </span>
      ))}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between mt-4">
      <button
        className="btn btn-sm btn-ghost"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span className="text-xs text-base-content/40">
        Page {page} of {totalPages}
      </span>
      <button
        className="btn btn-sm btn-ghost"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
