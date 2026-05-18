import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataSource, tableExists } from "../data/select";
import { sourcesQueries } from "../data/queries/sources";
import {
  listSources as listSourceConfigs,
  getSourceById,
} from "../data/sourceOps";
import {
  getDerivationByTag,
  listDerivationsForSource,
} from "../data/derivationOps";
import { getTraitByLabel } from "../data/traitOps";
import type {
  ConfigDerivation,
  ConfigSource,
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

export const fetchProvenance = async (): Promise<SourceProvenance[]> => {
  // main.data_sources is a runtime provenance table populated by builds;
  // on a fresh DB before any build, it doesn't exist. Return empty so
  // /sources renders the "no sources" state cleanly.
  const { tableExists } = await import("../data/select");
  if (!(await tableExists("data_sources"))) return [];
  return getDataSource().query<SourceProvenance>(sourcesQueries.provenance());
};

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
  // Wires the new build orchestrator (load → route → loci). The source
  // must already exist in config.sources with at least one derivation
  // before calling — the wizard handles that for the user.
  const { buildSource } = await import("../data/pipeline/build");
  const result = await buildSource(req.name);
  const totalEvidenceRows = result.derivations.reduce(
    (acc, d) => acc + d.rows,
    0,
  );
  return { success: true, imported: req.name, rows: totalEvidenceRows };
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

// Phase 7: prefer the canonical trait_id join (redesigned builds put
// trait_id on scored_evidence). Resolve the URL trait *label* to a
// config.traits row and group sources by trait_id. Fall back to the
// legacy studies/string-match join for CLI-built DBs that predate the
// redesign (no trait_id, but a populated `studies` table).
export const fetchSourcesForTrait = async (
  trait: string,
): Promise<SourceContribution[]> => {
  const ds = getDataSource();
  if (!(await tableExists("scored_evidence"))) return [];
  try {
    const t = await getTraitByLabel(trait);
    if (t?.id) {
      const rows = await ds.query<SourceContribution>(
        sourcesQueries.sourcesForTraitId(t.id),
      );
      if (rows.length > 0) return rows;
    }
  } catch {
    /* config.traits absent on a legacy DB — fall through to legacy join */
  }
  if (!(await tableExists("studies"))) return [];
  return ds.query<SourceContribution>(sourcesQueries.sourcesForTrait(trait));
};

export const useTraitSources = (trait: string) =>
  useQuery({
    queryKey: ["traits", trait, "sources"],
    queryFn: () => fetchSourcesForTrait(trait),
    enabled: !!trait,
  });

// Phase 7: config view of a built source, keyed by a derivation's
// source_tag (what the read pages route on). Resolves tag → derivation
// → its source → all derivations on that source, so the source-detail
// page can show "Used as" roles, the derivation list, and citation.
// Returns empty for legacy CLI sources with no config row.
export interface SourceConfigByTag {
  source: ConfigSource | null;
  derivations: ConfigDerivation[];
}

export const fetchSourceConfigByTag = async (
  sourceTag: string,
): Promise<SourceConfigByTag> => {
  try {
    const d = await getDerivationByTag(sourceTag);
    if (!d) return { source: null, derivations: [] };
    const source = await getSourceById(d.source_id);
    const derivations = source
      ? await listDerivationsForSource(source.id)
      : [d];
    return { source: source ?? null, derivations };
  } catch {
    return { source: null, derivations: [] };
  }
};

export const useSourceConfigByTag = (sourceTag: string) =>
  useQuery({
    queryKey: ["sources", sourceTag, "config"],
    queryFn: () => fetchSourceConfigByTag(sourceTag),
    enabled: !!sourceTag,
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
