// Mapping read+write ops. A mapping is the projection unit that turns a
// (cleaned) raw source into one output stream — target='evidence' emits
// canonical evidence rows, target='loci' builds loci. Column aliases live in
// mapping_fields; trait scope in mapping_traits / mapping_trait_column.
// Transforms are NOT here — they're source-level (sourceTransformOps.ts).

import { getDataSource } from "./select";
import { bumpSourceAudit } from "./sourceOps";
import type {
  ConfigMapping,
  MappingCentric,
  MappingField,
  MappingTarget,
  MappingTraitColumn,
  MappingTraitScope,
} from "../api/types";

// --- Row shapes ---

type MappingRow = {
  id: string;
  source_id: string;
  source_tag: string;
  display_name: string | null;
  target: string;
  evidence_category: string | null;
  score_column: string | null;
  centric: string | null;
  trait_scope: string | null;
  window_kb: number | null;
  merge_distance_kb: number | null;
  row_version: number;
  created_by: string | null;
  last_edited_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type FieldRow = {
  canonical_field: string;
  raw_column: string;
};

type TraitColumnRow = {
  raw_column: string;
  trait_id_lookup: string | null;
};

function rowToMapping(
  row: MappingRow,
  fields: FieldRow[],
  traitIds: string[],
  traitColumn: TraitColumnRow | null,
): ConfigMapping {
  const out: ConfigMapping = {
    id: row.id,
    source_id: row.source_id,
    source_tag: row.source_tag,
    target: row.target as MappingTarget,
    row_version: Number(row.row_version),
  };
  if (row.display_name != null) out.display_name = row.display_name;
  if (row.evidence_category != null)
    out.evidence_category = row.evidence_category;
  if (row.score_column != null) out.score_column = row.score_column;
  if (row.centric != null) out.centric = row.centric as MappingCentric;
  if (row.trait_scope != null)
    out.trait_scope = row.trait_scope as MappingTraitScope;
  if (row.window_kb != null) out.window_kb = Number(row.window_kb);
  if (row.merge_distance_kb != null)
    out.merge_distance_kb = Number(row.merge_distance_kb);
  if (row.created_by != null) out.created_by = row.created_by;
  if (row.last_edited_by != null) out.last_edited_by = row.last_edited_by;
  if (row.created_at != null) out.created_at = row.created_at;
  if (row.updated_at != null) out.updated_at = row.updated_at;
  if (fields.length > 0) {
    out.fields = fields.map((m): MappingField => ({
      canonical_field: m.canonical_field,
      raw_column: m.raw_column,
    }));
  }
  if (traitIds.length > 0) out.trait_ids = traitIds;
  if (traitColumn) {
    const tc: MappingTraitColumn = { raw_column: traitColumn.raw_column };
    if (traitColumn.trait_id_lookup != null) {
      tc.trait_id_lookup = traitColumn.trait_id_lookup;
    }
    out.trait_column = tc;
  }
  return out;
}

async function fetchMappingChildren(mappingId: string): Promise<{
  fields: FieldRow[];
  traitIds: string[];
  traitColumn: TraitColumnRow | null;
}> {
  const ds = getDataSource();
  const [fields, traitRows, traitColRows] = await Promise.all([
    ds.query<FieldRow>({
      sql:
        "SELECT canonical_field, raw_column FROM config.mapping_fields " +
        "WHERE mapping_id = ?",
      params: [mappingId],
    }),
    ds.query<{ trait_id: string }>({
      sql: "SELECT trait_id FROM config.mapping_traits WHERE mapping_id = ?",
      params: [mappingId],
    }),
    ds.query<TraitColumnRow>({
      sql:
        "SELECT raw_column, trait_id_lookup FROM config.mapping_trait_column " +
        "WHERE mapping_id = ? LIMIT 1",
      params: [mappingId],
    }),
  ]);
  return {
    fields,
    traitIds: traitRows.map((r) => r.trait_id),
    traitColumn: traitColRows[0] ?? null,
  };
}

const SELECT_COLS =
  "id, source_id, source_tag, display_name, target, evidence_category, " +
  "score_column, centric, trait_scope, window_kb, merge_distance_kb, row_version, " +
  "created_by, last_edited_by, created_at, updated_at";

// --- READS ---

export async function listMappingsForSource(
  sourceId: string,
): Promise<ConfigMapping[]> {
  const ds = getDataSource();
  const rows = await ds.query<MappingRow>({
    sql:
      `SELECT ${SELECT_COLS} FROM config.mappings ` +
      "WHERE source_id = ? ORDER BY created_at",
    params: [sourceId],
  });
  return Promise.all(
    rows.map(async (row) => {
      const { fields, traitIds, traitColumn } = await fetchMappingChildren(
        row.id,
      );
      return rowToMapping(row, fields, traitIds, traitColumn);
    }),
  );
}

export async function getMapping(id: string): Promise<ConfigMapping | null> {
  const ds = getDataSource();
  const rows = await ds.query<MappingRow>({
    sql: `SELECT ${SELECT_COLS} FROM config.mappings WHERE id = ? LIMIT 1`,
    params: [id],
  });
  const row = rows[0];
  if (!row) return null;
  const { fields, traitIds, traitColumn } = await fetchMappingChildren(row.id);
  return rowToMapping(row, fields, traitIds, traitColumn);
}

export async function getMappingByTag(
  sourceTag: string,
): Promise<ConfigMapping | null> {
  const ds = getDataSource();
  const rows = await ds.query<MappingRow>({
    sql:
      `SELECT ${SELECT_COLS} FROM config.mappings WHERE source_tag = ? LIMIT 1`,
    params: [sourceTag],
  });
  const row = rows[0];
  if (!row) return null;
  const { fields, traitIds, traitColumn } = await fetchMappingChildren(row.id);
  return rowToMapping(row, fields, traitIds, traitColumn);
}

// --- WRITES ---

export interface InsertMappingInput {
  source_id: string;
  source_tag: string;
  display_name?: string;
  target: MappingTarget;
  evidence_category?: string;
  score_column?: string;
  centric?: MappingCentric;
  trait_scope?: MappingTraitScope;
  window_kb?: number;
  merge_distance_kb?: number;
  fields?: MappingField[];
  /** When trait_scope = 'constant'. */
  trait_ids?: string[];
  /** When trait_scope = 'column'. */
  trait_column?: MappingTraitColumn;
}

export async function insertMapping(
  input: InsertMappingInput,
  actor: string | null = null,
): Promise<string> {
  const ds = getDataSource();
  const [row] = await ds.query<{ id: string }>({
    sql:
      "INSERT INTO config.mappings " +
      "  (source_id, source_tag, display_name, target, evidence_category, " +
      "   score_column, centric, trait_scope, window_kb, merge_distance_kb, " +
      "   created_by, last_edited_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    params: [
      input.source_id,
      input.source_tag,
      input.display_name ?? null,
      input.target,
      input.evidence_category ?? null,
      input.score_column ?? null,
      input.centric ?? null,
      input.trait_scope ?? null,
      input.window_kb ?? null,
      input.merge_distance_kb ?? null,
      actor,
      actor,
    ],
  });
  if (!row) throw new Error("INSERT config.mappings returned no rows");
  const mappingId = row.id;

  await insertMappingChildren(mappingId, {
    fields: input.fields ?? [],
    trait_ids: input.trait_ids ?? [],
    trait_column: input.trait_column ?? null,
  });
  // Reflect the change on the parent source's audit so the source's
  // last_edited reflects the mapping change too.
  await bumpSourceAudit(input.source_id, actor);
  return mappingId;
}

export type UpdateMappingPatch = Partial<
  Pick<
    ConfigMapping,
    | "source_tag"
    | "display_name"
    | "target"
    | "evidence_category"
    | "score_column"
    | "centric"
    | "trait_scope"
    | "window_kb"
    | "merge_distance_kb"
  >
> & {
  fields?: MappingField[];
  trait_ids?: string[];
  trait_column?: MappingTraitColumn | null;
};

export async function updateMapping(
  id: string,
  patch: UpdateMappingPatch,
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  // Load the full current mapping so we can rewrite the complete child set.
  // DuckDB rejects UPDATE on a row still referenced by FK children (even when
  // the referenced key is unchanged), so we clear ALL children first, then
  // UPDATE the parent, then reinsert — which means we need the child types
  // the patch didn't touch.
  const current = await getMapping(id);
  if (!current) throw new Error(`Mapping ${id} not found`);

  const effective = {
    fields: patch.fields ?? current.fields ?? [],
    trait_ids: patch.trait_ids ?? current.trait_ids ?? [],
    trait_column:
      "trait_column" in patch
        ? patch.trait_column ?? null
        : current.trait_column ?? null,
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  const addSet = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ("source_tag" in patch) addSet("source_tag", patch.source_tag);
  if ("display_name" in patch)
    addSet("display_name", patch.display_name ?? null);
  if ("target" in patch) addSet("target", patch.target);
  if ("evidence_category" in patch)
    addSet("evidence_category", patch.evidence_category ?? null);
  if ("score_column" in patch) addSet("score_column", patch.score_column ?? null);
  if ("centric" in patch) addSet("centric", patch.centric ?? null);
  if ("trait_scope" in patch) addSet("trait_scope", patch.trait_scope ?? null);
  if ("window_kb" in patch) addSet("window_kb", patch.window_kb ?? null);
  if ("merge_distance_kb" in patch)
    addSet("merge_distance_kb", patch.merge_distance_kb ?? null);

  // 1. Clear every child so the parent UPDATE's FK check passes.
  await deleteAllMappingChildren(id);

  // 2. Update the parent row. Always bump last_edited_by so an update that
  //    only changes children (e.g. fields) still records the actor.
  sets.push("last_edited_by = ?");
  params.push(actor);
  sets.push("row_version = row_version + 1");
  sets.push("updated_at = now()");
  params.push(id);
  await ds.exec({
    sql: `UPDATE config.mappings SET ${sets.join(", ")} WHERE id = ?`,
    params,
  });

  // 3. Reinsert the full merged child set.
  await insertMappingChildren(id, effective);

  await bumpSourceAudit(current.source_id, actor);
}

async function deleteAllMappingChildren(id: string): Promise<void> {
  const ds = getDataSource();
  await ds.exec({
    sql: "DELETE FROM config.mapping_fields WHERE mapping_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.mapping_traits WHERE mapping_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.mapping_trait_column WHERE mapping_id = ?",
    params: [id],
  });
}

async function insertMappingChildren(
  mappingId: string,
  c: {
    fields: MappingField[];
    trait_ids: string[];
    trait_column: MappingTraitColumn | null;
  },
): Promise<void> {
  const ds = getDataSource();
  for (const m of c.fields) {
    await ds.exec({
      sql:
        "INSERT INTO config.mapping_fields " +
        "  (mapping_id, canonical_field, raw_column) VALUES (?, ?, ?)",
      params: [mappingId, m.canonical_field, m.raw_column],
    });
  }
  for (const traitId of c.trait_ids) {
    await ds.exec({
      sql:
        "INSERT INTO config.mapping_traits (mapping_id, trait_id) " +
        "VALUES (?, ?) ON CONFLICT DO NOTHING",
      params: [mappingId, traitId],
    });
  }
  if (c.trait_column) {
    await ds.exec({
      sql:
        "INSERT INTO config.mapping_trait_column " +
        "  (mapping_id, raw_column, trait_id_lookup) VALUES (?, ?, ?)",
      params: [
        mappingId,
        c.trait_column.raw_column,
        c.trait_column.trait_id_lookup ?? null,
      ],
    });
  }
}

export async function removeMapping(
  id: string,
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  // Capture source_id before the row goes away so we can bump the parent's
  // audit after deletion.
  const current = await getMapping(id);
  await deleteAllMappingChildren(id);
  await ds.exec({
    sql: "DELETE FROM config.mappings WHERE id = ?",
    params: [id],
  });
  if (current) await bumpSourceAudit(current.source_id, actor);
}
