// JSON import/export of a source's MAPPINGS — power-user bulk editing
// alongside the card UI. Portable shape: no ids/audit/source_id, and traits
// travel by LABEL (resolved/created on import) so a config survives recreates
// and moves between DBs. Transforms are handled in the Transforms tab directly
// (its draft is already an array); only mappings need DB ops + trait
// label↔id resolution, which live here.

import {
  listMappingsForSource,
  insertMapping,
  removeMapping,
  type InsertMappingInput,
} from "./mappingOps";
import { ingestSource } from "./pipeline/ingest";
import { replaceSourceTransforms } from "./sourceTransformOps";
import type { InsertSourceInput } from "./sourceOps";
import { listTraits, findOrCreateByLabel } from "./traitOps";
import type {
  MappingCentric,
  MappingField,
  MappingTarget,
  MappingTraitColumn,
  MappingTraitScope,
} from "../api/types";

export interface MappingJson {
  source_tag: string;
  display_name?: string;
  target: MappingTarget;
  evidence_category?: string;
  primary_value_column?: string;
  secondary_value_column?: string;
  primary_value_label?: string;
  secondary_value_label?: string;
  centric?: MappingCentric;
  window_kb?: number;
  merge_distance_kb?: number;
  fields?: MappingField[];
  trait_scope?: MappingTraitScope;
  /** trait_scope = 'constant': trait LABELS (not UUIDs) for portability. */
  trait_labels?: string[];
  /** trait_scope = 'column'. */
  trait_column?: MappingTraitColumn;
}

/** Serialize a source's mappings to portable JSON (trait UUIDs → labels). */
export async function exportMappings(sourceId: string): Promise<MappingJson[]> {
  const [mappings, traits] = await Promise.all([
    listMappingsForSource(sourceId),
    listTraits(),
  ]);
  const labelById = new Map(traits.map((t) => [t.id, t.label]));
  return mappings.map((m) => {
    const j: MappingJson = { source_tag: m.source_tag, target: m.target };
    if (m.display_name) j.display_name = m.display_name;
    if (m.evidence_category) j.evidence_category = m.evidence_category;
    if (m.primary_value_column) j.primary_value_column = m.primary_value_column;
    if (m.secondary_value_column)
      j.secondary_value_column = m.secondary_value_column;
    if (m.primary_value_label) j.primary_value_label = m.primary_value_label;
    if (m.secondary_value_label)
      j.secondary_value_label = m.secondary_value_label;
    if (m.centric) j.centric = m.centric;
    if (m.window_kb != null) j.window_kb = m.window_kb;
    if (m.merge_distance_kb != null) j.merge_distance_kb = m.merge_distance_kb;
    if (m.fields?.length) j.fields = m.fields;
    if (m.trait_scope) j.trait_scope = m.trait_scope;
    if (m.trait_ids?.length)
      j.trait_labels = m.trait_ids.map((id) => labelById.get(id) ?? id);
    if (m.trait_column) j.trait_column = m.trait_column;
    return j;
  });
}

export interface ImportResult {
  inserted: number;
  /** Per-entry failures (shape/insert errors); valid entries still applied. */
  errors: string[];
}

/** Import mappings from parsed JSON. `replace` clears the source's existing
 *  mappings first; `append` adds to them. trait_labels are resolved (or
 *  created) to trait_ids. Shape-invalid entries are reported and skipped; the
 *  rest are applied. Throws only if the top-level value isn't an array. */
export async function importMappings(
  sourceId: string,
  raw: unknown,
  mode: "append" | "replace",
  actor: string | null = null,
): Promise<ImportResult> {
  if (!Array.isArray(raw)) {
    throw new Error("Expected a JSON array of mapping objects.");
  }
  const items = raw as MappingJson[];

  if (mode === "replace") {
    const existing = await listMappingsForSource(sourceId);
    for (const m of existing) await removeMapping(m.id, actor);
  }

  const errors: string[] = [];
  let inserted = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tag = it?.source_tag ?? "?";
    try {
      if (!it || typeof it !== "object") throw new Error("not an object");
      if (!it.source_tag?.trim()) throw new Error("missing source_tag");
      if (it.target !== "evidence" && it.target !== "loci") {
        throw new Error("target must be 'evidence' or 'loci'");
      }
      const input: InsertMappingInput = {
        source_id: sourceId,
        source_tag: it.source_tag,
        target: it.target,
      };
      if (it.display_name) input.display_name = it.display_name;
      if (it.evidence_category) input.evidence_category = it.evidence_category;
      if (it.primary_value_column)
        input.primary_value_column = it.primary_value_column;
      if (it.secondary_value_column)
        input.secondary_value_column = it.secondary_value_column;
      if (it.primary_value_label)
        input.primary_value_label = it.primary_value_label;
      if (it.secondary_value_label)
        input.secondary_value_label = it.secondary_value_label;
      if (it.centric) input.centric = it.centric;
      if (it.window_kb != null) input.window_kb = it.window_kb;
      if (it.merge_distance_kb != null)
        input.merge_distance_kb = it.merge_distance_kb;
      if (it.fields?.length) input.fields = it.fields;
      if (it.trait_scope) input.trait_scope = it.trait_scope;
      if (it.trait_labels?.length) {
        const ids: string[] = [];
        for (const label of it.trait_labels) {
          ids.push(await findOrCreateByLabel(label, actor));
        }
        input.trait_ids = ids;
      }
      if (it.trait_column) input.trait_column = it.trait_column;
      await insertMapping(input, actor);
      inserted++;
    } catch (e) {
      errors.push(`#${i + 1} (${tag}): ${(e as Error).message}`);
    }
  }
  return { inserted, errors };
}

// --- Whole-source import (power-user: create an entire source from one config
//     JSON) -----------------------------------------------------------------
// Composes the three existing layers — ingestSource (create + fetch raw table),
// replaceSourceTransforms (the pipeline), importMappings (the projections) — so
// a single `{ source, transforms, mappings }` document recreates a source in one
// shot. Transforms travel FLAT (`{ type, ...params }`, the Transforms-tab JSON
// shape); mappings as MappingJson[]; traits by label. The combined shape matches
// the per-source config files under staging/pegasus.v2f/configs/.

/** A flat transform step as it appears in the Transforms-tab JSON: the `type`
 *  discriminant plus its params inline. */
export type TransformJson = { type: string } & Record<string, unknown>;

export interface SourceConfigJson {
  source: InsertSourceInput;
  transforms?: TransformJson[];
  mappings?: MappingJson[];
}

export interface ImportSourceResult {
  source_id: string;
  name: string;
  rows: number;
  transforms: number;
  mappings: ImportResult;
}

const SOURCE_NAME_RE = /^[a-z][a-z0-9_]*$/;
const SOURCE_TYPES = new Set([
  "googlesheets",
  "csv",
  "tsv",
  "parquet",
  "url",
]);

/** Create an entire source from a combined config object. Throws on a fatal
 *  problem (bad shape, name/type/url validation, ingest failure); per-mapping
 *  problems come back in `mappings.errors`. */
export async function importSourceConfig(
  raw: unknown,
  actor: string | null = null,
): Promise<ImportSourceResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected a config object with a `source` block.");
  }
  const cfg = raw as SourceConfigJson;
  const src = cfg.source;
  if (!src || typeof src !== "object") {
    throw new Error("Missing `source` block.");
  }
  if (!src.name || !SOURCE_NAME_RE.test(src.name)) {
    throw new Error(
      "source.name must be lowercase letters, digits, and underscores (starting with a letter).",
    );
  }
  if (!SOURCE_TYPES.has(src.source_type)) {
    throw new Error(
      `source.source_type must be one of: ${[...SOURCE_TYPES].join(", ")}.`,
    );
  }
  if (typeof src.url === "string" && src.url.includes("<<")) {
    throw new Error(
      "source.url is still a placeholder — set the real data URL before importing.",
    );
  }

  // 1. Create + ingest (fetches the URL, materializes the raw table).
  const input: InsertSourceInput = {
    name: src.name,
    source_type: src.source_type,
    display_name: src.display_name,
    description: src.description,
    url: src.url,
    sheet: src.sheet || undefined,
    skip_rows: src.skip_rows,
    citation: src.citation,
  };
  const ingest = await ingestSource(input, undefined, actor);
  const sourceId = ingest.source.id;

  // 2. Transform pipeline (flat { type, ...params } → { type, params }).
  const transforms = (cfg.transforms ?? []).map((t) => {
    const { type, ...params } = t;
    return { type, params };
  });
  if (transforms.length) {
    await replaceSourceTransforms(sourceId, transforms, actor);
  }

  // 3. Mappings (fresh source → "replace" is equivalent to "append").
  const mappings = await importMappings(
    sourceId,
    cfg.mappings ?? [],
    "replace",
    actor,
  );

  return {
    source_id: sourceId,
    name: src.name,
    rows: ingest.rows,
    transforms: transforms.length,
    mappings,
  };
}
