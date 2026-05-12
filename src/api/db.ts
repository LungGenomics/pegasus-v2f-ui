import { useQuery } from "@tanstack/react-query";
import { getDataSource } from "../data/select";
import { dbQueries } from "../data/queries/db";
import { fetchChromSizes as fetchChromSizesDirect } from "../data/chromSizes";
import { EVIDENCE_CATEGORIES } from "../data/static";
import type { ChromSizes, DbStatus, EvidenceCategories, TableInfo } from "./types";

const COUNT_TABLES = [
  "studies",
  "loci",
  "genes",
  "evidence",
  "scored_evidence",
  "data_sources",
] as const;

/** Read which tables exist in main schema. Used to skip missing-table
 *  queries before they fire — DuckDB-WASM logs SQL errors to the
 *  console even when our code catches them, so "check then query" is
 *  the only way to silence the noise. */
async function fetchMainTables(
  ds: ReturnType<typeof getDataSource>,
): Promise<Set<string>> {
  try {
    const rows = await ds.query<{ table_name: string }>({
      sql:
        "SELECT table_name FROM information_schema.tables " +
        "WHERE table_schema = 'main'",
    });
    return new Set(rows.map((r) => r.table_name));
  } catch {
    return new Set();
  }
}

const countIfExists = async (
  ds: ReturnType<typeof getDataSource>,
  table: string,
  existing: Set<string>,
): Promise<number> => {
  if (!existing.has(table)) return 0;
  const [r] = await ds.query<{ n: number }>(dbQueries.rowCount(table));
  return Number(r?.n ?? 0);
};

const metaIfExists = async (
  ds: ReturnType<typeof getDataSource>,
  key: string,
  existing: Set<string>,
): Promise<string> => {
  if (!existing.has("_pegasus_meta")) return "-";
  const [r] = await ds.query<{ value: string }>(dbQueries.metaValue(key));
  return r?.value ?? "-";
};

export const fetchStatus = async (): Promise<DbStatus> => {
  const ds = getDataSource();
  const existing = await fetchMainTables(ds);
  const counts = await Promise.all(
    COUNT_TABLES.map((t) => countIfExists(ds, t, existing)),
  );
  const [n_studies, n_loci, n_genes, n_evidence_rows, n_scored_rows, n_sources] =
    counts as [number, number, number, number, number, number];
  const has_pegasus = n_scored_rows > 0;
  const [genome_build, package_version] = await Promise.all([
    metaIfExists(ds, "genome_build", existing),
    metaIfExists(ds, "package_version", existing),
  ]);
  return {
    n_studies,
    n_loci,
    n_genes,
    n_evidence_rows,
    n_sources,
    has_pegasus,
    genome_build,
    package_version,
  } as DbStatus;
};

export const fetchTables = async (): Promise<TableInfo[]> => {
  const ds = getDataSource();
  const tables = await ds.query<{ table_name: string }>(dbQueries.tables());
  const existing = new Set(tables.map((t) => t.table_name));
  const counts = await Promise.all(
    tables.map((t) => countIfExists(ds, t.table_name, existing)),
  );
  return tables.map((t, i) => ({
    name: t.table_name,
    row_count: counts[i] ?? 0,
  }));
};

// Reassemble the V2fConfig shape from the relational config.* tables. Kept
// for any consumer still expecting the old YAML shape; new code should query
// config.* directly via configReads / sourceOps.
export const fetchConfig = async (): Promise<Record<string, unknown>> => {
  const { listSources } = await import("../data/sourceOps");
  const ds = getDataSource();
  const data_sources = await listSources();
  let pegasus: Record<string, unknown> | undefined;
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
    /* config schema may not be migrated yet */
  }
  return { data_sources, ...(pegasus ? { pegasus } : {}) };
};

export const fetchEvidenceCategories = async (): Promise<EvidenceCategories> =>
  EVIDENCE_CATEGORIES;

// Adapter-agnostic raw-SQL helper (used by the ad-hoc query console).
// Routes through the active DataSource so DuckDB-WASM mode runs locally
// and REST mode hits POST /db/query.
export const executeQuery = (query: string) =>
  getDataSource().query<Record<string, unknown>>({ sql: query });

export const useDbStatus = () =>
  useQuery({ queryKey: ["db", "status"], queryFn: fetchStatus });

export const useTables = () =>
  useQuery({ queryKey: ["db", "tables"], queryFn: fetchTables });

export const useDbConfig = () =>
  useQuery({ queryKey: ["db", "config"], queryFn: fetchConfig });

export const useEvidenceCategories = () =>
  useQuery({
    queryKey: ["db", "evidence-categories"],
    queryFn: fetchEvidenceCategories,
    staleTime: Infinity,
  });

export const fetchChromSizes = async (): Promise<ChromSizes> => {
  const ds = getDataSource();
  const existing = await fetchMainTables(ds);
  const build = await metaIfExists(ds, "genome_build", existing);
  return fetchChromSizesDirect(build === "-" ? "hg38" : build);
};

export const useChromSizes = () =>
  useQuery({
    queryKey: ["db", "chrom-sizes"],
    queryFn: fetchChromSizes,
    staleTime: Infinity,
  });

