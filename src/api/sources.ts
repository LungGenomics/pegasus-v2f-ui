import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import { sourcesQueries } from "../data/queries/sources";
import { listSources as listSourceConfigs } from "../data/sourceOps";
import type {
  ImportRequest,
  ImportResult,
  MutationResult,
  Source,
  SourceContribution,
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

// Pipeline ops — fully ported in Phase 1c.

export const previewGoogleSheet = async (
  ss: string,
  sheet = "",
  skip = 0,
): Promise<Record<string, unknown>[]> => {
  // Fetch a Google Sheet as CSV via its export URL, parse client-side, and
  // return up to 100 rows for preview. Mirrors the Python /sources/preview
  // route that the config workspace used to call.
  const idMatch = ss.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new Error(`Could not extract spreadsheet ID from URL: ${ss}`);
  const params = new URLSearchParams({ format: "csv" });
  if (sheet) params.set("sheet", sheet);
  const url = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?${params}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Google Sheets fetch failed (${res.status} ${res.statusText})`);
  }
  const text = await res.text();
  const aq = await import("arquero");
  let table = aq.fromCSV(text);
  if (skip > 0) table = table.slice(skip);
  return table.slice(0, 100).objects() as Record<string, unknown>[];
};

export const importSource = async (req: ImportRequest): Promise<ImportResult> => {
  // STUBBED during Phase 0 of the web-first config redesign — the legacy
  // build pipeline is being replaced (Phase 1). Until that lands, callers
  // get a clear error rather than a half-broken import attempt.
  const { getSource } = await import("../data/sourceOps");
  const source = await getSource(req.name);
  if (!source) {
    throw new Error(
      `Source '${req.name}' is not in config — add it via the config workspace first.`,
    );
  }
  const { importSource: runImport } = await import("../data/pipeline/import");
  await runImport();
  return { success: true, imported: req.name, rows: 0 };
};

export const updateSource = async (name: string): Promise<MutationResult> => {
  // Re-import semantics: same as a fresh import. The CREATE OR REPLACE
  // table swap in importSource() makes this idempotent.
  await importSource({ name, data: [] });
  return { success: true };
};

export const materializeScores = async (): Promise<MutationResult> => {
  const { materializeScoredEvidence } = await import(
    "../data/pipeline/materialize"
  );
  const result = await materializeScoredEvidence();
  return {
    success: true,
    scored: result.scored_rows,
    loci: result.loci,
  } as MutationResult & { scored: number; loci: number };
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

export const fetchSourcesForTrait = (
  trait: string,
): Promise<SourceContribution[]> =>
  getDataSource().query<SourceContribution>(
    sourcesQueries.sourcesForTrait(trait),
  );

export const useTraitSources = (trait: string) =>
  useQuery({
    queryKey: ["traits", trait, "sources"],
    queryFn: () => fetchSourcesForTrait(trait),
    enabled: !!trait,
  });

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
