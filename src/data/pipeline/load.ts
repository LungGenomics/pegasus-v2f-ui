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
    // all_varchar: read every column as text. Type auto-detection samples only
    // the first ~20k rows and would mis-type e.g. a chromosome column as BIGINT
    // (chr 1–22) then fail on a later "X". Raw is provenance text; the
    // coerce_numeric/math transforms cast what needs to be numeric downstream.
    const readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, all_varchar=true, skip=${
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
    const readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, all_varchar=true, delim=${strLit(delim)}, skip=${
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

/** Build a FetchedRaw from an uploaded File's bytes (no network). The
 *  read expression is chosen from the file extension; skip_rows is
 *  honored the same way as the URL path. Parquet is read directly. */
async function prepareFromFile(
  source: Pick<ConfigSource, "name" | "skip_rows">,
  file: File,
): Promise<FetchedRaw> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  const isParquet = lower.endsWith(".parquet");
  const isTsv = lower.endsWith(".tsv") || lower.endsWith(".txt");
  const ext = isParquet ? "parquet" : isTsv ? "tsv" : "csv";
  const registerAs = `${source.name}.${ext}`;
  const readExpr = isParquet
    ? `read_parquet(${strLit(registerAs)})`
    : `read_csv_auto(${strLit(registerAs)}, header=true, all_varchar=true, delim=${strLit(
        isTsv ? "\t" : ",",
      )}, skip=${source.skip_rows ?? 0})`;
  return { bytes, registerAs, readExpr };
}

export interface LoadResult {
  source_id: string;
  raw_table: string;
  rows: number;
}

// (previewSource removed with the Add Data wizard — the raw-table grid
// reads the materialized table directly now; ingest happens on add.)

/** Materialize a prepared raw payload into main.raw_<source_id>.
 *  Idempotent — CREATE OR REPLACE TABLE wipes any prior contents. */
async function writeRawTable(
  source: ConfigSource,
  fetched: FetchedRaw,
): Promise<LoadResult> {
  const ds = getDataSource();
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

/** Load a URL/sheet-backed source's raw bytes into main.raw_<id>. */
export async function loadRawSource(source: ConfigSource): Promise<LoadResult> {
  return writeRawTable(source, await fetchAndPrepare(source));
}

/** Ingest an uploaded File's bytes into main.raw_<id> — no network.
 *  The only raw path for `source_type = "file"` sources (they have no
 *  URL to re-fetch; the raw table is their durable copy). */
export async function ingestRawFile(
  source: ConfigSource,
  file: File,
): Promise<LoadResult> {
  return writeRawTable(source, await prepareFromFile(source, file));
}

export interface RawPreview {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Read a small sample of a not-yet-ingested source for preview. Registers
 *  the bytes under a fixed scratch name, SELECTs a LIMITed sample (no
 *  permanent table), then drops the registered file. Used by the add-source
 *  panel before the user commits the ingest. */
export async function previewRaw(
  input: Pick<ConfigSource, "source_type" | "url" | "sheet" | "skip_rows">,
  file: File | null,
  limit = 50,
): Promise<RawPreview> {
  // Fixed scratch name so name edits don't re-trigger the preview and so it
  // never clashes with a real raw table.
  const pseudo = { ...input, name: "_preview" } as ConfigSource;
  const fetched = file
    ? await prepareFromFile(pseudo, file)
    : await fetchAndPrepare(pseudo);

  const ds = getDataSource();
  const adapter = await import("../adapters/duckdb-wasm");
  await adapter.registerSourceBytes(fetched.registerAs, fetched.bytes);
  try {
    const rows = await ds.query<Record<string, unknown>>({
      sql: `SELECT * FROM ${fetched.readExpr} LIMIT ${limit}`,
    });
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return { columns, rows };
  } finally {
    await adapter.dropRegisteredFile(fetched.registerAs).catch(() => {});
  }
}
