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
