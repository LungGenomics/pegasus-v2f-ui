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

/** Load a source's raw bytes into main.raw_<source_id>. Idempotent —
 *  CREATE OR REPLACE TABLE wipes any prior contents. */
export async function loadRawSource(source: ConfigSource): Promise<LoadResult> {
  const ds = getDataSource();
  const fetched = await fetchAndPrepare(source);
  const tableName = rawTableName(source.id);

  // The adapter exposes registerSourceBytes (see duckdb-wasm.ts) for
  // registering a virtual file under a chosen filename. Cast to the
  // adapter shape; the legacy DataSource interface doesn't surface it.
  type RegisterCapable = {
    registerSourceBytes?: (name: string, bytes: Uint8Array) => Promise<void>;
    dropRegisteredFile?: (name: string) => Promise<void>;
  };
  const adapter = ds as unknown as RegisterCapable;
  if (typeof adapter.registerSourceBytes !== "function") {
    throw new Error(
      "Active DataSource doesn't support virtual file registration; raw load requires the DuckDB-WASM adapter.",
    );
  }
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
    if (typeof adapter.dropRegisteredFile === "function") {
      await adapter.dropRegisteredFile(fetched.registerAs).catch(() => {});
    }
  }
}
