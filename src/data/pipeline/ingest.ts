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

import {
  insertSource,
  getSource,
  getSourceById,
  updateSource,
  bumpSourceAudit,
} from "../sourceOps";
import type { InsertSourceInput, UpdateSourcePatch } from "../sourceOps";
import { loadRawSource, ingestRawFile } from "./load";
import { getDataSource } from "../select";
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
  actor: string | null = null,
): Promise<IngestResult> {
  const usesFile = !!file;
  if (!usesFile && !input.url) {
    throw new Error(
      "Add source needs either an uploaded file or a URL to ingest from.",
    );
  }

  const id = await insertSource(input, actor);
  const source = await getSourceById(id);
  if (!source) {
    throw new Error("Source row vanished immediately after insert.");
  }

  const result = usesFile
    ? await ingestRawFile(source, file!)
    : await loadRawSource(source);

  // Bump raw_version so the source's content signature changes (the
  // raw table lives outside config.sources, so the config row's
  // row_version wouldn't otherwise move). Only on explicit ingest —
  // build's internal URL re-load must NOT bump (it isn't an edit).
  await getDataSource().exec({
    sql: "UPDATE config.sources SET raw_version = raw_version + 1 WHERE id = ?",
    params: [id],
  });

  return { source, rawTable: result.raw_table, rows: result.rows };
}

/**
 * Re-ingest an existing source's raw table — used when its upstream changed
 * or its ingest settings (url / sheet / skip_rows) were wrong. Applies any
 * metadata patch first (so the re-fetch uses the new settings), then
 * rebuilds main.raw_<id> (CREATE OR REPLACE wipes the old contents).
 *
 * @param name   existing source name
 * @param patch  optional url/sheet/skip_rows edits to apply before fetching
 * @param file   required for file-backed sources (no URL to re-fetch);
 *   for URL/sheet sources, omit it and the loader re-fetches.
 */
export async function reingestSource(
  name: string,
  patch: Pick<UpdateSourcePatch, "url" | "sheet" | "skip_rows">,
  file?: File,
  actor: string | null = null,
): Promise<IngestResult> {
  // Apply ingest-setting edits first (also bumps the source's audit).
  if (Object.keys(patch).length > 0) {
    await updateSource(name, patch, actor);
  }

  const source = await getSource(name);
  if (!source) {
    throw new Error(`Source '${name}' not found`);
  }
  if (!file && !source.url) {
    throw new Error(
      "Re-ingest needs an uploaded file (file source) or a URL to fetch from.",
    );
  }

  const result = file
    ? await ingestRawFile(source, file)
    : await loadRawSource(source);

  // Same raw_version bump as ingestSource — the raw table changed.
  await getDataSource().exec({
    sql: "UPDATE config.sources SET raw_version = raw_version + 1 WHERE id = ?",
    params: [source.id],
  });
  // updateSource above bumped audit when a patch was given; for a no-patch
  // re-fetch (URL source, same settings) still record who re-ingested.
  if (Object.keys(patch).length === 0) {
    await bumpSourceAudit(source.id, actor);
  }

  return { source, rawTable: result.raw_table, rows: result.rows };
}
