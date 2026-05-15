// Raw-layer loader. Fetches a source's file, parses, and writes it to
// main.raw_<source_id>. The raw table is the only permanent storage of
// the as-ingested data — derivations recompute from it on each build.
//
// Carried over from the prior loader.ts; signature now takes ConfigSource
// (post web-first redesign) instead of V2fSourceConfig.

import type { ConfigSource } from "../../api/types";
import { getDataSource } from "../select";
import { rawTableName } from "../sourceOps";

/** Convert a Google Sheets URL to its CSV-export form. */
function googleSheetsToCsvUrl(url: string, sheet?: string): string {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    throw new Error(`Could not extract spreadsheet ID from URL: ${url}`);
  }
  const id = idMatch[1];
  const params = new URLSearchParams({ format: "csv" });
  if (sheet) params.set("sheet", sheet);
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params.toString()}`;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status} ${res.statusText}): ${url}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function strLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

interface FetchedRaw {
  bytes: Uint8Array;
  registerAs: string;
  readExpr: string;
}

/** Fetch + figure out the SQL expression that reads the registered file. */
async function fetchAndPrepare(source: ConfigSource): Promise<FetchedRaw> {
  const sourceType = source.source_type;
  const url = source.url;
  if (!url) {
    throw new Error(`Source '${source.name}' has no URL configured`);
  }

  if (sourceType === "googlesheets") {
    const csvUrl = googleSheetsToCsvUrl(url, source.sheet);
    const bytes = await fetchBytes(csvUrl);
    const registerAs = `${source.name}.csv`;
    const readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, skip=${
      source.skip_rows ?? 0
    })`;
    return { bytes, registerAs, readExpr };
  }

  if (sourceType === "csv" || sourceType === "tsv" || sourceType === "url") {
    const bytes = await fetchBytes(url);
    const isTsv =
      sourceType === "tsv" || url.endsWith(".tsv") || url.endsWith(".txt");
    const registerAs = `${source.name}.${isTsv ? "tsv" : "csv"}`;
    const delim = isTsv ? "\t" : ",";
    const readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, delim=${strLit(delim)}, skip=${
      source.skip_rows ?? 0
    })`;
    return { bytes, registerAs, readExpr };
  }

  if (sourceType === "parquet") {
    const bytes = await fetchBytes(url);
    const registerAs = `${source.name}.parquet`;
    const readExpr = `read_parquet(${strLit(registerAs)})`;
    return { bytes, registerAs, readExpr };
  }

  throw new Error(
    `Unsupported source_type '${sourceType}'. Supported: googlesheets, csv, tsv, url, parquet.`,
  );
}

export interface LoadResult {
  source_id: string;
  raw_table: string;
  rows: number;
}

export interface PreviewResult {
  columns: string[];
  sampleRows: Record<string, unknown>[];
  totalRows: number;
}

/** Fetch + parse a source's file in memory and return columns + sample
 *  rows, without writing anything to the DB. Used by the Add Data
 *  wizard's step 1 so the user can see real columns before the source
 *  is committed. Supports the same source types as loadRawSource. */
export async function previewSource(
  source: Pick<ConfigSource, "source_type" | "url" | "sheet" | "skip_rows" | "name">,
): Promise<PreviewResult> {
  // Build a minimal ConfigSource so fetchAndPrepare's contract is
  // satisfied. id isn't used by the fetch path.
  const fakeId = "preview";
  const fetched = await fetchAndPrepare({
    id: fakeId,
    name: source.name || "preview",
    source_type: source.source_type,
    url: source.url,
    sheet: source.sheet,
    skip_rows: source.skip_rows,
  });

  const aq = await import("arquero");
  let table;
  if (source.source_type === "parquet") {
    // Arquero can't parse Parquet directly; tell the user.
    throw new Error(
      "Parquet preview isn't supported in the wizard yet — save the source first and use the source detail page to inspect.",
    );
  }
  const text = new TextDecoder().decode(fetched.bytes);
  const delim =
    source.source_type === "tsv" ||
    fetched.registerAs.endsWith(".tsv") ||
    fetched.registerAs.endsWith(".txt")
      ? "\t"
      : ",";
  table = aq.fromCSV(text, { delimiter: delim });
  if ((source.skip_rows ?? 0) > 0) {
    table = table.slice(source.skip_rows ?? 0);
  }

  return {
    columns: table.columnNames(),
    sampleRows: table.slice(0, 10).objects() as Record<string, unknown>[],
    totalRows: table.numRows(),
  };
}

/** Load a source's raw bytes into main.raw_<source_id>. Idempotent —
 *  CREATE OR REPLACE TABLE wipes any prior contents. */
export async function loadRawSource(source: ConfigSource): Promise<LoadResult> {
  const ds = getDataSource();
  const fetched = await fetchAndPrepare(source);
  const tableName = rawTableName(source.id);

  // registerSourceBytes / dropRegisteredFile are module-level exports of
  // the DuckDB-WASM adapter, not methods on the DataSource instance.
  // Import the module the same way select.ts does.
  const adapter = await import("../adapters/duckdb-wasm");

  await adapter.registerSourceBytes(fetched.registerAs, fetched.bytes);
  try {
    await ds.exec({
      sql:
        `CREATE OR REPLACE TABLE main."${tableName}" AS SELECT * FROM ${fetched.readExpr}`,
    });
    const [count] = await ds.query<{ n: number }>({
      sql: `SELECT COUNT(*) AS n FROM main."${tableName}"`,
    });
    return {
      source_id: source.id,
      raw_table: tableName,
      rows: Number(count?.n ?? 0),
    };
  } finally {
    await adapter.dropRegisteredFile(fetched.registerAs).catch(() => {});
  }
}
