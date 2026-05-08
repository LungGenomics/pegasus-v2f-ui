import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import type { V2fConfig, V2fSourceConfig, MutationResult } from "./types";

// Reassemble V2fConfig from the new config.* tables.
export const fetchConfig = async (): Promise<V2fConfig> => {
  const ds = getDataSource();
  const { listSources } = await import("../data/sourceOps");
  const { listStudies } = await import("../data/studyOps");
  const [data_sources, studies] = await Promise.all([
    listSources(),
    listStudies().catch(() => []),
  ]);
  let pegasus: V2fConfig["pegasus"] | undefined;
  try {
    const [settings] = await ds.query<{
      window_kb: number;
      merge_distance_kb: number;
    }>({
      sql:
        "SELECT window_kb, merge_distance_kb FROM config.pegasus_settings WHERE id = 1",
    });
    if (settings) {
      pegasus = {
        locus_definition: {
          window_kb: settings.window_kb,
          merge_distance_kb: settings.merge_distance_kb,
        },
      };
    }
  } catch {
    /* config schema may not exist yet (pre-migration) */
  }
  if (studies.length > 0) {
    pegasus = { ...(pegasus ?? {}), study: studies };
  }
  return { data_sources, ...(pegasus ? { pegasus } : {}) };
};

// HGNC gene mapping — read from main.gene_mapping if loaded.
// Returns {} if the table doesn't exist yet (caller should run the
// loader). Used by client-side preview transforms in the config workspace.
export const fetchGeneMap = async (): Promise<Record<string, string>> => {
  try {
    const rows = await getDataSource().query<{
      ensembl_gene_id: string;
      symbol: string;
    }>({ sql: "SELECT ensembl_gene_id, symbol FROM main.gene_mapping" });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.ensembl_gene_id] = r.symbol;
    return out;
  } catch {
    return {};
  }
};

export interface TransformTypeSchema {
  type: string;
  description: string;
  params: Record<string, { type: string; description: string; enum?: string[] }>;
}

// Phase 2 of the DB-first plan replaces this with per-type JSON Schemas
// in the UI bundle. For now, empty list (forms accept free-form params).
export const fetchTransformTypes = async (): Promise<TransformTypeSchema[]> => [];

export const useConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: fetchConfig });

export const useGeneMap = () =>
  useQuery({
    queryKey: ["reference", "gene-map"],
    queryFn: fetchGeneMap,
    staleTime: Infinity,
  });

export const useTransformTypes = () =>
  useQuery({
    queryKey: ["reference", "transform-types"],
    queryFn: fetchTransformTypes,
    staleTime: Infinity,
  });

type PatchSourceArgs = { name: string; source: V2fSourceConfig; build?: boolean };
type PatchSourceResult = MutationResult & {
  rows?: number;
  built?: boolean;
  build_error?: string;
};

const patchSource = async (args: PatchSourceArgs): Promise<PatchSourceResult> => {
  const { patchSourceConfig } = await import("../data/sourceOps");
  await patchSourceConfig(args.name, args.source);
  if (!args.build) {
    return { success: true };
  }
  // Build: re-run the import pipeline against the now-updated config.
  try {
    const { importSource } = await import("../data/pipeline/import");
    const result = await importSource(args.source);
    return {
      success: true,
      built: true,
      rows: result.rows,
    };
  } catch (err) {
    return {
      success: true,
      built: false,
      build_error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const usePatchSource = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchSource,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["db", "status"] });
    },
  });
};
