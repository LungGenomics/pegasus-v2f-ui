import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import { sourcesQueries } from "../data/queries/sources";
import { listSources as listSourceConfigs } from "../data/sourceOps";
import type {
  ImportRequest,
  ImportResult,
  MutationResult,
  Source,
  SourceEvidenceResponse,
  SourceLocus,
  SourceEvidenceRow,
  SourceProvenance,
  SourceVariant,
} from "./types";

// Source list reads from config.source_configs (and children) directly.
export const fetchSources = async (): Promise<Source[]> => {
  const sources = await listSourceConfigs();
  return sources as unknown as Source[];
};

export const fetchProvenance = (): Promise<SourceProvenance[]> =>
  getDataSource().query<SourceProvenance>(sourcesQueries.provenance());

// Pipeline ops — not yet ported. They throw cleanly so callers can show a
// helpful error rather than crashing on a fetch.
const PIPELINE_NOT_READY =
  "Pipeline operations (preview, import, build, materialize) need the " +
  "pipeline runtime, which lands in Phase 1c.";

export const previewGoogleSheet = async (
  _ss: string,
  _sheet = "",
  _skip = 0,
): Promise<Record<string, unknown>[]> => {
  throw new Error(PIPELINE_NOT_READY);
};

export const importSource = async (_req: ImportRequest): Promise<ImportResult> => {
  throw new Error(PIPELINE_NOT_READY);
};

export const updateSource = async (_name: string): Promise<MutationResult> => {
  throw new Error(PIPELINE_NOT_READY);
};

export const materializeScores = async (): Promise<MutationResult> => {
  throw new Error(PIPELINE_NOT_READY);
};

export const deleteSource = async (name: string): Promise<MutationResult> => {
  const { removeSource } = await import("../data/sourceOps");
  await removeSource(name);
  return { success: true };
};

export const fetchSourceEvidence = async (
  sourceTag: string,
): Promise<SourceEvidenceResponse> => {
  const ds = getDataSource();
  const loci = await ds.query<SourceLocus>(sourcesQueries.evidenceLoci(sourceTag));
  const evidence = await ds.query<SourceEvidenceRow>(
    sourcesQueries.evidenceRows(sourceTag),
  );
  const has = (field: keyof SourceEvidenceRow) =>
    evidence.some((r) => {
      const v = r[field];
      return v !== null && v !== undefined && v !== "-" && v !== "";
    });
  let has_positions = false;
  try {
    const [pos] = await ds.query<{ n: number }>(
      sourcesQueries.positionCount(sourceTag),
    );
    has_positions = (pos?.n ?? 0) > 0;
  } catch {
    /* evidence table may not exist */
  }
  return {
    loci,
    evidence,
    data_profile: {
      has_positions,
      has_scores: has("score"),
      has_pvalues: has("pvalue"),
    },
  };
};

export const fetchSourceVariants = (sourceTag: string): Promise<SourceVariant[]> =>
  getDataSource().query<SourceVariant>(sourcesQueries.variants(sourceTag));

export const useSources = () =>
  useQuery({ queryKey: ["sources"], queryFn: fetchSources });

export const useSourceEvidence = (sourceTag: string | null) =>
  useQuery({
    queryKey: ["sources", sourceTag, "evidence"],
    queryFn: () => fetchSourceEvidence(sourceTag!),
    enabled: !!sourceTag,
  });

export const useSourceVariants = (sourceTag: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ["sources", sourceTag, "variants"],
    queryFn: () => fetchSourceVariants(sourceTag!),
    enabled: !!sourceTag && enabled,
  });

export const useProvenance = () =>
  useQuery({ queryKey: ["sources", "provenance"], queryFn: fetchProvenance });

export const useImportSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: importSource,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["db", "status"] });
    },
  });
};

export const useDeleteSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["db", "status"] });
    },
  });
};

export const useUpdateSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateSource,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
};

export const useMaterialize = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: materializeScores,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["studies"] });
      void qc.invalidateQueries({ queryKey: ["loci"] });
      void qc.invalidateQueries({ queryKey: ["genes"] });
    },
  });
};
