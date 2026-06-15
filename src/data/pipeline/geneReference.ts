// Gene-reference loader. Loads the hg38 gene-coordinate parquet ONCE per
// session into a local table `main.gene_reference`. The parquet is BUNDLED
// with the frontend (src/data/gene_reference.parquet, ~2.6 MB, GENCODE v49)
// rather than fetched from R2 — guarantees availability, no CORS, works
// offline. The locus_evidence view joins this local table.
//
// Columns (produced by scripts/build_gene_reference.py):
//   gene_symbol, ensembl_gene_id, chromosome, start, end, strand, gene_type
// Chromosome is UCSC style ("chr1") = the canonical internal format.
//
// main.gene_reference is session-local working state — reconstructable from
// the bundled asset, so it is NOT published (publish excludes main.* derived).

import { getDataSource } from "../select";
// Bundled asset → a hashed URL emitted to dist (not inlined into the JS).
import geneReferenceUrl from "../gene_reference.parquet?url";

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

  // Fetch the bundled parquet (same-origin asset) and register the bytes so
  // read_parquet can see the file (fetch→register pattern, no httpfs needed).
  const res = await fetch(geneReferenceUrl);
  if (!res.ok) {
    throw new Error(`Gene reference load failed (${res.status})`);
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

/** main.gene_mapping: the Ensembl→HGNC lookup the `map_gene_id` transform joins
 *  (`gm.ensembl_gene_id`, `gm.symbol`). A view over gene_reference (which carries
 *  ensembl_gene_id + gene_symbol), so it always reflects the loaded reference.
 *  Ensures gene_reference is loaded first. Replaces the never-implemented
 *  createGeneMappingTable() referenced by transform/compile.ts. */
export async function ensureGeneMappingTable(): Promise<void> {
  await ensureGeneReference();
  const ds = getDataSource();
  await ds.exec({
    sql:
      "CREATE OR REPLACE VIEW main.gene_mapping AS " +
      // Strip any Ensembl version (ENSG….5 → ENSG…) so the join matches the
      // compiler's version-stripped input regardless of the reference's style.
      "SELECT DISTINCT REGEXP_REPLACE(ensembl_gene_id, '\\.\\d+$', '') AS ensembl_gene_id, " +
      "       gene_symbol AS symbol " +
      "FROM main.gene_reference " +
      "WHERE ensembl_gene_id IS NOT NULL AND gene_symbol IS NOT NULL",
  });
}
