// HGNC gene mapping loader — populates main.gene_mapping with the
// Ensembl gene ID → HGNC symbol mapping used by the map_gene_id transform.
//
// Mirrors cli/src/pegasus_v2f/gene_mapping.py.

import { getDataSource } from "../select";

const HGNC_URL =
  "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt";

export type GeneMappingResult = {
  rows: number;
  source_url: string;
};

/** Idempotent: drops + recreates main.gene_mapping. */
export async function loadGeneMapping(
  url: string = HGNC_URL,
): Promise<GeneMappingResult> {
  const ds = getDataSource();

  // Fetch the TSV.
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `HGNC fetch failed (${res.status} ${res.statusText}). ` +
        `If this is a CORS error, either deploy a fetch proxy or pre-bundle the TSV.`,
    );
  }
  const text = await res.text();

  // Parse: only need ensembl_gene_id and symbol columns. Strip version
  // suffixes from Ensembl IDs (ENSG00000227232.5 → ENSG00000227232).
  const aq = await import("arquero");
  const table = aq
    .fromCSV(text, { delimiter: "\t" })
    .select("ensembl_gene_id", "symbol")
    .filter(
      (d: { ensembl_gene_id: unknown; symbol: unknown }) =>
        d.ensembl_gene_id != null && d.symbol != null,
    );
  const rows = table.objects() as Array<{
    ensembl_gene_id: string;
    symbol: string;
  }>;

  // Strip version suffix
  const stripped = rows
    .map((r) => ({
      ensembl_gene_id: String(r.ensembl_gene_id).split(".")[0]!,
      symbol: String(r.symbol),
    }))
    .filter((r) => r.ensembl_gene_id && r.symbol);

  // Build the table fresh.
  await ds.exec({
    sql:
      `CREATE OR REPLACE TABLE main.gene_mapping (` +
      `  ensembl_gene_id VARCHAR PRIMARY KEY, ` +
      `  symbol VARCHAR NOT NULL` +
      `)`,
  });

  // Insert in batches to avoid massive single statements.
  const BATCH = 1000;
  for (let i = 0; i < stripped.length; i += BATCH) {
    const batch = stripped.slice(i, i + BATCH);
    const values = batch
      .map(
        (r) =>
          `('${r.ensembl_gene_id.replace(/'/g, "''")}', '${r.symbol.replace(/'/g, "''")}')`,
      )
      .join(", ");
    await ds.exec({
      sql: `INSERT INTO main.gene_mapping (ensembl_gene_id, symbol) VALUES ${values}`,
    });
  }

  return { rows: stripped.length, source_url: url };
}

/** Has the gene_mapping table been populated? */
export async function hasGeneMapping(): Promise<boolean> {
  try {
    const [r] = await getDataSource().query<{ n: number }>({
      sql: "SELECT COUNT(*) AS n FROM main.gene_mapping",
    });
    return Number(r?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
