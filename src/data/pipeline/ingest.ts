// Ingest-on-add (Phase 1 of the source-workspace restructure).
//
// "Add source" = create the config.sources row AND immediately
// materialize main.raw_<id> into the local working DB — no derivation,
// no build required. The raw table is the durable, first-class copy
// (model D2): URL/sheet sources can be re-fetched, file sources cannot,
// so for files the materialized table IS the only copy.
//
// Everything here writes to the local OPFS-backed DuckDB and persists
// immediately (model D1); publishing to the shared R2 copy is a later,
// explicit step.

import { insertSource, getSourceById } from "../sourceOps";
import type { InsertSourceInput } from "../sourceOps";
import { loadRawSource, ingestRawFile } from "./load";
import type { ConfigSource } from "../../api/types";

export interface IngestResult {
  source: ConfigSource;
  rawTable: string;
  rows: number;
}

/**
 * Create a source and ingest its raw table in one step.
 *
 * @param input source metadata (name/type/url/sheet/skip_rows/…)
 * @param file  required when `input.source_type === "file"` (or any
 *   source with no URL); the uploaded file's bytes become the raw
 *   table. For URL/sheet sources, omit it and the loader fetches.
 */
export async function ingestSource(
  input: InsertSourceInput,
  file?: File,
): Promise<IngestResult> {
  const usesFile = !!file;
  if (!usesFile && !input.url) {
    throw new Error(
      "Add source needs either an uploaded file or a URL to ingest from.",
    );
  }

  const id = await insertSource(input);
  const source = await getSourceById(id);
  if (!source) {
    throw new Error("Source row vanished immediately after insert.");
  }

  const result = usesFile
    ? await ingestRawFile(source, file!)
    : await loadRawSource(source);

  return { source, rawTable: result.raw_table, rows: result.rows };
}
