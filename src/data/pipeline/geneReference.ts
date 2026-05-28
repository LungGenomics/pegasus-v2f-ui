// Gene-reference loader. Fetches the hg38 gene-coordinate parquet
// (config.pegasus_settings.gene_reference_url) ONCE per session and
// materializes it into a local table `main.gene_reference`. The
// locus_evidence view joins this local table — so the parquet is read over
// the network once, not on every query (plan 2026-05-28, Q3 refinement).
//
// Columns (produced by scripts/build_gene_reference.py):
//   gene_symbol, ensembl_gene_id, chromosome, start, end, strand, gene_type
// Chromosome is UCSC style ("chr1") = the canonical internal format.
//
// main.gene_reference is session-local working state — reconstructable from
// the URL, so it is NOT published (the publish path excludes main.* derived
// relations).

import { getDataSource } from "../select";

// The gene reference is infrastructure, not user config — its URL is a
// built-in constant (the hg38 GENCODE parquet on the project R2 bucket, same
// bucket as the DB sync). config.pegasus_settings.gene_reference_url is an
// optional override for swapping builds, not something a user normally sets.
export const DEFAULT_GENE_REFERENCE_URL =
  "https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev/reference/gencode_genes_hg38.parquet";

const REGISTER_NAME = "_gene_reference.parquet";

async function tableExists(name: string): Promise<boolean> {
  const ds = getDataSource();
  try {
    await ds.query({ sql: `SELECT 1 FROM main.${name} LIMIT 0` });
    return true;
  } catch {
    return false;
  }
}

/** The effective gene-reference URL: the optional settings override, else the
 *  built-in default. */
export async function getGeneReferenceUrl(): Promise<string> {
  const ds = getDataSource();
  const [row] = await ds.query<{ gene_reference_url: string | null }>({
    sql: "SELECT gene_reference_url FROM config.pegasus_settings WHERE id = 1",
  });
  return row?.gene_reference_url || DEFAULT_GENE_REFERENCE_URL;
}

/** Whether main.gene_reference is already loaded (non-empty). */
export async function geneReferenceLoaded(): Promise<boolean> {
  const ds = getDataSource();
  if (!(await tableExists("gene_reference"))) return false;
  const [c] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.gene_reference",
  });
  return Number(c?.n ?? 0) > 0;
}

/** Distinct biotypes in the loaded gene reference, by descending gene count.
 *  Empty when the reference isn't loaded yet. Drives the biotype picker. */
export async function listGeneBiotypes(): Promise<
  Array<{ gene_type: string; n: number }>
> {
  if (!(await geneReferenceLoaded())) return [];
  const ds = getDataSource();
  return ds.query<{ gene_type: string; n: number }>({
    sql:
      "SELECT gene_type, COUNT(*) AS n FROM main.gene_reference " +
      "GROUP BY gene_type ORDER BY n DESC",
  });
}

/** Ensure main.gene_reference is loaded. The FULL parquet (all biotypes) is
 *  fetched once and materialized; biotype filtering happens later in the
 *  locus_evidence view, so changing biotypes never refetches. Skips the fetch
 *  when the table is already present (persists in OPFS across reloads) unless
 *  `force` (e.g. the parquet was rebuilt upstream). Returns the row count. */
export async function ensureGeneReference(force = false): Promise<number> {
  const ds = getDataSource();

  if (!force && (await geneReferenceLoaded())) {
    const [c] = await ds.query<{ n: number }>({
      sql: "SELECT COUNT(*) AS n FROM main.gene_reference",
    });
    return Number(c?.n ?? 0);
  }

  const url = await getGeneReferenceUrl();
  // Fetch the bytes and register them so read_parquet can see the file
  // (same fetch→register pattern as the raw loader — avoids relying on
  // httpfs being available in the WASM bundle).
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Gene reference fetch failed (${res.status}): ${url}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  const adapter = await import("../adapters/duckdb-wasm");
  await adapter.registerSourceBytes(REGISTER_NAME, bytes);
  try {
    await ds.exec({
      sql:
        `CREATE OR REPLACE TABLE main.gene_reference AS ` +
        `SELECT * FROM read_parquet('${REGISTER_NAME}')`,
    });
  } finally {
    await adapter.dropRegisteredFile(REGISTER_NAME).catch(() => {});
  }

  const [c] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.gene_reference",
  });
  return Number(c?.n ?? 0);
}
