import { useQuery } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import { studiesQueries } from "../data/queries/studies";
import type { Effector, Locus, LocusGene, Study, StudyDetail } from "./types";

export const fetchStudies = (): Promise<Study[]> =>
  getDataSource().query<Study>(studiesQueries.list());

export const fetchStudy = async (id: string): Promise<StudyDetail> => {
  const ds = getDataSource();
  const [study] = await ds.query<StudyDetail>(studiesQueries.detail(id));
  if (!study) throw new Error(`Study '${id}' not found`);
  // Aggregate counts (best-effort — missing tables produce empty results)
  try {
    const r = (await ds.query<{ n: number }>(studiesQueries.countLoci(id)))[0];
    study.n_loci_actual = Number(r?.n ?? 0);
  } catch {
    /* table may not exist */
  }
  try {
    const r1 = (await ds.query<{ n: number }>(
      studiesQueries.countCandidateGenes(id),
    ))[0];
    study.n_candidate_genes = Number(r1?.n ?? 0);
    const r2 = (await ds.query<{ n: number }>(
      studiesQueries.countEffectors(id),
    ))[0];
    study.n_effectors = Number(r2?.n ?? 0);
    const cats = await ds.query<{ evidence_category: string }>(
      studiesQueries.evidenceCategories(id),
    );
    study.evidence_categories = cats.map((r) => r.evidence_category);
  } catch {
    /* scored_evidence may not exist */
  }
  return study;
};

export const fetchStudyLoci = (id: string): Promise<Locus[]> =>
  getDataSource().query<Locus>(studiesQueries.studyLoci(id));

export const fetchStudyEffectors = (id: string): Promise<Effector[]> =>
  getDataSource().query<Effector>(studiesQueries.studyEffectors(id));

export const fetchAllLoci = (limit = 500): Promise<Locus[]> =>
  getDataSource().query<Locus>(studiesQueries.allLoci(limit));

// LocusGene rows from scored_evidence get grouped by gene client-side.
type LocusGeneRow = {
  gene_symbol: string;
  evidence_category: string | null;
  source_tag: string | null;
  trait: string | null;
  pvalue: number | string | null;
  effect_size: number | string | null;
  score: number | string | null;
  tissue: string | null;
  cell_type: string | null;
  rsid: string | null;
  ancestry: string | null;
  sex: string | null;
  match_type: string | null;
  integration_rank: number | null;
  is_predicted_effector: boolean | null;
  n_candidate_genes: number | null;
};

export const fetchLocusGenes = async (locusId: string): Promise<LocusGene[]> => {
  const rows = await getDataSource().query<LocusGeneRow>(
    studiesQueries.locusGenesRaw(locusId),
  );
  const byGene = new Map<string, LocusGene>();
  for (const r of rows) {
    let gene = byGene.get(r.gene_symbol);
    if (!gene) {
      gene = {
        gene_symbol: r.gene_symbol,
        distance_to_lead_kb: "",
        is_nearest_gene: false,
        is_within_locus: false,
        integration_score: "",
        integration_rank: r.integration_rank ?? "",
        is_predicted_effector: r.is_predicted_effector ?? false,
        evidence: [],
      } as unknown as LocusGene;
      // Carry n_candidate_genes for callers that read it off any gene
      (gene as unknown as { n_candidate_genes?: number }).n_candidate_genes =
        r.n_candidate_genes ?? undefined;
      byGene.set(r.gene_symbol, gene);
    }
    if (r.evidence_category) {
      gene.evidence.push({
        evidence_category: r.evidence_category,
        evidence_stream: "",
        source_tag: r.source_tag ?? "",
        pvalue: r.pvalue ?? "",
        effect_size: r.effect_size ?? "",
        score: r.score ?? "",
        tissue: r.tissue ?? "",
        cell_type: r.cell_type ?? "",
        is_supporting: "",
        ancestry: r.ancestry ?? undefined,
        sex: r.sex ?? undefined,
      });
    }
  }
  return [...byGene.values()];
};

export const useStudies = () =>
  useQuery({ queryKey: ["studies"], queryFn: fetchStudies });

export const useStudy = (id: string) =>
  useQuery({
    queryKey: ["studies", id],
    queryFn: () => fetchStudy(id),
    enabled: !!id,
  });

export const useStudyLoci = (id: string) =>
  useQuery({
    queryKey: ["studies", id, "loci"],
    queryFn: () => fetchStudyLoci(id),
    enabled: !!id,
  });

export const useStudyEffectors = (id: string) =>
  useQuery({
    queryKey: ["studies", id, "effectors"],
    queryFn: () => fetchStudyEffectors(id),
    enabled: !!id,
  });

export const useAllLoci = () =>
  useQuery({ queryKey: ["loci"], queryFn: () => fetchAllLoci() });

export const useLocusGenes = (locusId: string) =>
  useQuery({
    queryKey: ["loci", locusId, "genes"],
    queryFn: () => fetchLocusGenes(locusId),
    enabled: !!locusId,
  });
