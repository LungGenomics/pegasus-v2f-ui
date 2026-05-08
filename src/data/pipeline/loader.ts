// Source data loaders. Each one fetches/parses the raw bytes for a source
// and returns a Uint8Array buffer that DuckDB-WASM can register and read via
// read_csv_auto / read_parquet.

import type { V2fSourceConfig } from "../../api/types";

/** Convert a Google Sheets URL to its CSV-export form. */
function googleSheetsToCsvUrl(url: string, sheet?: string): string {
  // Accept either a /edit URL or a /spreadsheets/d/{ID} URL. Output:
  //   https://docs.google.com/spreadsheets/d/{ID}/export?format=csv[&gid={GID}]
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    throw new Error(`Could not extract spreadsheet ID from URL: ${url}`);
  }
  const id = idMatch[1];
  const params = new URLSearchParams({ format: "csv" });
  if (sheet) {
    // Sheets exposes named tabs via &sheet=Name; gid would need a lookup.
    params.set("sheet", sheet);
  }
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params.toString()}`;
}

/** Fetch a URL and return its bytes. */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status} ${res.statusText}): ${url}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export type LoadedSource = {
  /** Raw bytes ready to be registered with DuckDB-WASM. */
  bytes: Uint8Array;
  /** Canonical filename DuckDB will see — picked to match the right reader. */
  registerAs: string;
  /** SQL expression to select from the registered file (read_csv_auto, etc.). */
  readExpr: string;
};

/** Load a source into bytes + a SQL read expression. */
export async function loadSource(source: V2fSourceConfig): Promise<LoadedSource> {
  const sourceType = source.source_type;
  const url = source.url;
  if (!url) {
    throw new Error(`Source '${source.name}' has no URL configured`);
  }

  // CORS: many public URLs work; private buckets / intranet don't. Errors
  // here surface to the caller as fetch failures.
  let bytes: Uint8Array;
  let registerAs: string;
  let readExpr: string;

  if (sourceType === "googlesheets") {
    const csvUrl = googleSheetsToCsvUrl(url, source.sheet);
    bytes = await fetchBytes(csvUrl);
    registerAs = `${source.name}.csv`;
    readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, skip=${
      source.skip_rows ?? 0
    })`;
  } else if (
    sourceType === "csv" ||
    sourceType === "tsv" ||
    sourceType === "url"
  ) {
    bytes = await fetchBytes(url);
    const isTsv = sourceType === "tsv" || url.endsWith(".tsv") || url.endsWith(".txt");
    registerAs = `${source.name}.${isTsv ? "tsv" : "csv"}`;
    const delim = isTsv ? "\t" : ",";
    readExpr = `read_csv_auto(${strLit(registerAs)}, header=true, delim=${strLit(delim)}, skip=${
      source.skip_rows ?? 0
    })`;
  } else if (sourceType === "parquet") {
    bytes = await fetchBytes(url);
    registerAs = `${source.name}.parquet`;
    readExpr = `read_parquet(${strLit(registerAs)})`;
  } else {
    throw new Error(
      `Unsupported source_type '${sourceType}'. Supported: googlesheets, csv, tsv, url, parquet.`,
    );
  }

  return { bytes, registerAs, readExpr };
}

function strLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
