import { useQuery } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import { genesQueries } from "../data/queries/genes";
import type { Gene, GeneEvidence, GeneScore, GeneSearchResult } from "./types";

export interface PaginatedResponse<T> {
  results: T[];
  total: number;
}

const PAGE_SIZE = 50;

const runSearch = async (
  search: string,
  limit: number,
  offset: number,
  scoredOnly: boolean,
): Promise<PaginatedResponse<GeneSearchResult>> => {
  const ds = getDataSource();
  const [results, [count]] = await Promise.all([
    ds.query<GeneSearchResult>(
      genesQueries.search({ search, limit, offset, scoredOnly }),
    ),
    ds.query<{ n: number }>(genesQueries.searchCount({ search, scoredOnly })),
  ]);
  return { results, total: Number(count?.n ?? 0) };
};

export const searchGenes = (search: string, limit = PAGE_SIZE, offset = 0) =>
  runSearch(search, limit, offset, false);

export const fetchScoredGenes = (limit = PAGE_SIZE, offset = 0) =>
  runSearch("", limit, offset, true);

export const fetchGene = async (gene: string): Promise<Gene> => {
  const ds = getDataSource();
  const [fromGenes] = await ds.query<Gene>(genesQueries.detailFromGenes(gene));
  if (fromGenes) return fromGenes;
  const [fromIndex] = await ds.query<Gene>(genesQueries.detailFromSearchIndex(gene));
  if (fromIndex) return fromIndex;
  throw new Error(`Gene '${gene}' not found`);
};

export const fetchGeneEvidence = async (gene: string): Promise<GeneEvidence[]> => {
  const rows = await getDataSource().query<Record<string, unknown>>(
    genesQueries.evidence(gene),
  );
  return rows.map((r) => ({
    ...r,
    evidence_level: r.chromosome ? "variant" : "gene",
  })) as unknown as GeneEvidence[];
};

export const fetchGeneScores = (gene: string): Promise<GeneScore[]> =>
  getDataSource().query<GeneScore>(genesQueries.scores(gene));

export const useGeneSearch = (search: string, offset = 0) =>
  useQuery({
    queryKey: ["genes", "search", search, offset],
    queryFn: () => searchGenes(search, PAGE_SIZE, offset),
  });

export const useScoredGenes = (offset = 0) =>
  useQuery({
    queryKey: ["genes", "scored", offset],
    queryFn: () => fetchScoredGenes(PAGE_SIZE, offset),
  });

export const useGene = (gene: string) =>
  useQuery({
    queryKey: ["genes", gene],
    queryFn: () => fetchGene(gene),
    enabled: !!gene,
  });

export const useGeneEvidence = (gene: string) =>
  useQuery({
    queryKey: ["genes", gene, "evidence"],
    queryFn: () => fetchGeneEvidence(gene),
    enabled: !!gene,
  });

export const useGeneScores = (gene: string) =>
  useQuery({
    queryKey: ["genes", gene, "scores"],
    queryFn: () => fetchGeneScores(gene),
    enabled: !!gene,
  });
