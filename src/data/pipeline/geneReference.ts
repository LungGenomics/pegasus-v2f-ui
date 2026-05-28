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

// Module-level: which URL the current main.gene_reference was loaded from.
// Lets ensureGeneReference no-op when already loaded and reload when the
// setting changes mid-session.
let loadedUrl: string | null = null;

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

/** Read the configured gene-reference URL, or null if unset. */
export async function getGeneReferenceUrl(): Promise<string | null> {
  const ds = getDataSource();
  const [row] = await ds.query<{ gene_reference_url: string | null }>({
    sql: "SELECT gene_reference_url FROM config.pegasus_settings WHERE id = 1",
  });
  return row?.gene_reference_url ?? null;
}

/** Ensure main.gene_reference is loaded from the configured URL. Idempotent:
 *  no-ops when already loaded from the same URL, reloads when it changed.
 *  Throws if no URL is configured (caller decides whether that's fatal).
 *  Returns the row count. */
export async function ensureGeneReference(force = false): Promise<number> {
  const ds = getDataSource();
  const url = await getGeneReferenceUrl();
  if (!url) {
    throw new Error(
      "No gene_reference_url set in config.pegasus_settings — build + upload " +
        "the gene parquet (scripts/build_gene_reference.py) and set the URL.",
    );
  }

  if (
    !force &&
    loadedUrl === url &&
    (await tableExists("gene_reference"))
  ) {
    const [c] = await ds.query<{ n: number }>({
      sql: "SELECT COUNT(*) AS n FROM main.gene_reference",
    });
    return Number(c?.n ?? 0);
  }

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

  loadedUrl = url;
  const [c] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.gene_reference",
  });
  return Number(c?.n ?? 0);
}
