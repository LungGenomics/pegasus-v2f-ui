// STUBBED during Phase 0 of the web-first config redesign
// (2026-05-11-config-redesign-web-first.md). The legacy V2fConfig /
// V2fSourceConfig shapes don't match the new sources+derivations
// schema. The /config workspace will use new hooks
// (useConfigSources / useDerivations / useTraits) starting in Phase
// 3-4; until then, useConfig() returns an empty config so the workspace
// renders without crashing.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import type { V2fConfig, V2fSourceConfig, MutationResult } from "./types";

export const fetchConfig = async (): Promise<V2fConfig> => {
  // No translation from new schema → legacy V2fConfig in v1. Pages that
  // call useConfig() will see an empty list during the transition.
  return { data_sources: [] };
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

// Will be replaced by per-type JSON Schemas in the redesigned add-data
// wizard (Phase 3). Empty list for now — forms accept free-form params.
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

const patchSource = async (
  _args: PatchSourceArgs,
): Promise<PatchSourceResult> => {
  throw new Error(
    "patchSource is being rewritten as part of the web-first config " +
      "redesign (Phase 4). Use the new derivationOps for now.",
  );
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
