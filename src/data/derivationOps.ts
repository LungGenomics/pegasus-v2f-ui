// Derivation read+write ops. A derivation is the routing unit that
// turns one raw source into one stream of canonical evidence rows —
// (optional transforms) + (column mapping) + (trait scope). See plan
// 2026-05-11-config-redesign-web-first.md.

import { getDataSource } from "./select";
import type {
  ConfigDerivation,
  DerivationCentric,
  DerivationMapping,
  DerivationRole,
  DerivationTraitColumn,
  DerivationTraitScope,
  DerivationTransform,
} from "../api/types";

// --- Row shapes ---

type DerivationRow = {
  id: string;
  source_id: string;
  source_tag: string;
  display_name: string | null;
  role: string;
  evidence_category: string;
  centric: string;
  trait_scope: string;
  row_version: number;
  created_at: string | null;
  updated_at: string | null;
};

type MappingRow = {
  canonical_field: string;
  raw_column: string;
};

type TransformRow = {
  seq: number;
  type: string;
  params: string | Record<string, unknown> | null;
};

type TraitColumnRow = {
  raw_column: string;
  trait_id_lookup: string | null;
};

const parseJson = (
  v: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  if (v == null) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v;
};

function rowToDerivation(
  row: DerivationRow,
  mappings: MappingRow[],
  transforms: TransformRow[],
  traitIds: string[],
  traitColumn: TraitColumnRow | null,
): ConfigDerivation {
  const out: ConfigDerivation = {
    id: row.id,
    source_id: row.source_id,
    source_tag: row.source_tag,
    role: row.role as DerivationRole,
    evidence_category: row.evidence_category,
    centric: row.centric as DerivationCentric,
    trait_scope: row.trait_scope as DerivationTraitScope,
    row_version: Number(row.row_version),
  };
  if (row.display_name != null) out.display_name = row.display_name;
  if (row.created_at != null) out.created_at = row.created_at;
  if (row.updated_at != null) out.updated_at = row.updated_at;
  if (mappings.length > 0) {
    out.mappings = mappings.map((m): DerivationMapping => ({
      canonical_field: m.canonical_field,
      raw_column: m.raw_column,
    }));
  }
  if (transforms.length > 0) {
    out.transforms = transforms.map((t): DerivationTransform => ({
      seq: Number(t.seq),
      type: t.type,
      params: parseJson(t.params),
    }));
  }
  if (traitIds.length > 0) out.trait_ids = traitIds;
  if (traitColumn) {
    const tc: DerivationTraitColumn = { raw_column: traitColumn.raw_column };
    if (traitColumn.trait_id_lookup != null) {
      tc.trait_id_lookup = traitColumn.trait_id_lookup;
    }
    out.trait_column = tc;
  }
  return out;
}

async function fetchDerivationChildren(derivationId: string): Promise<{
  mappings: MappingRow[];
  transforms: TransformRow[];
  traitIds: string[];
  traitColumn: TraitColumnRow | null;
}> {
  const ds = getDataSource();
  const [mappings, transforms, traitRows, traitColRows] = await Promise.all([
    ds.query<MappingRow>({
      sql:
        "SELECT canonical_field, raw_column FROM config.derivation_mappings " +
        "WHERE derivation_id = ?",
      params: [derivationId],
    }),
    ds.query<TransformRow>({
      sql:
        "SELECT seq, type, params FROM config.derivation_transforms " +
        "WHERE derivation_id = ? ORDER BY seq",
      params: [derivationId],
    }),
    ds.query<{ trait_id: string }>({
      sql:
        "SELECT trait_id FROM config.derivation_traits WHERE derivation_id = ?",
      params: [derivationId],
    }),
    ds.query<TraitColumnRow>({
      sql:
        "SELECT raw_column, trait_id_lookup FROM config.derivation_trait_column " +
        "WHERE derivation_id = ? LIMIT 1",
      params: [derivationId],
    }),
  ]);
  return {
    mappings,
    transforms,
    traitIds: traitRows.map((r) => r.trait_id),
    traitColumn: traitColRows[0] ?? null,
  };
}

// --- READS ---

export async function listDerivationsForSource(
  sourceId: string,
): Promise<ConfigDerivation[]> {
  const ds = getDataSource();
  const rows = await ds.query<DerivationRow>({
    sql:
      "SELECT id, source_id, source_tag, display_name, role, " +
      "       evidence_category, centric, trait_scope, row_version, " +
      "       created_at, updated_at " +
      "FROM config.derivations WHERE source_id = ? ORDER BY created_at",
    params: [sourceId],
  });
  return Promise.all(
    rows.map(async (row) => {
      const { mappings, transforms, traitIds, traitColumn } =
        await fetchDerivationChildren(row.id);
      return rowToDerivation(row, mappings, transforms, traitIds, traitColumn);
    }),
  );
}

export async function getDerivation(
  id: string,
): Promise<ConfigDerivation | null> {
  const ds = getDataSource();
  const rows = await ds.query<DerivationRow>({
    sql:
      "SELECT id, source_id, source_tag, display_name, role, " +
      "       evidence_category, centric, trait_scope, row_version, " +
      "       created_at, updated_at " +
      "FROM config.derivations WHERE id = ? LIMIT 1",
    params: [id],
  });
  const row = rows[0];
  if (!row) return null;
  const { mappings, transforms, traitIds, traitColumn } =
    await fetchDerivationChildren(row.id);
  return rowToDerivation(row, mappings, transforms, traitIds, traitColumn);
}

export async function getDerivationByTag(
  sourceTag: string,
): Promise<ConfigDerivation | null> {
  const ds = getDataSource();
  const rows = await ds.query<DerivationRow>({
    sql:
      "SELECT id, source_id, source_tag, display_name, role, " +
      "       evidence_category, centric, trait_scope, row_version, " +
      "       created_at, updated_at " +
      "FROM config.derivations WHERE source_tag = ? LIMIT 1",
    params: [sourceTag],
  });
  const row = rows[0];
  if (!row) return null;
  const { mappings, transforms, traitIds, traitColumn } =
    await fetchDerivationChildren(row.id);
  return rowToDerivation(row, mappings, transforms, traitIds, traitColumn);
}

// --- WRITES ---

export interface InsertDerivationInput {
  source_id: string;
  source_tag: string;
  display_name?: string;
  role: DerivationRole;
  evidence_category: string;
  centric: DerivationCentric;
  trait_scope: DerivationTraitScope;
  mappings?: DerivationMapping[];
  transforms?: DerivationTransform[];
  /** When trait_scope = 'constant'. */
  trait_ids?: string[];
  /** When trait_scope = 'column'. */
  trait_column?: DerivationTraitColumn;
}

export async function insertDerivation(
  input: InsertDerivationInput,
): Promise<string> {
  const ds = getDataSource();
  const [row] = await ds.query<{ id: string }>({
    sql:
      "INSERT INTO config.derivations " +
      "  (source_id, source_tag, display_name, role, " +
      "   evidence_category, centric, trait_scope) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    params: [
      input.source_id,
      input.source_tag,
      input.display_name ?? null,
      input.role,
      input.evidence_category,
      input.centric,
      input.trait_scope,
    ],
  });
  if (!row) throw new Error("INSERT config.derivations returned no rows");
  const derivationId = row.id;

  await replaceChildren(derivationId, {
    mappings: input.mappings,
    transforms: input.transforms,
    trait_ids: input.trait_ids,
    trait_column: input.trait_column,
  });
  return derivationId;
}

export type UpdateDerivationPatch = Partial<
  Pick<
    ConfigDerivation,
    | "source_tag"
    | "display_name"
    | "role"
    | "evidence_category"
    | "centric"
    | "trait_scope"
  >
> & {
  mappings?: DerivationMapping[];
  transforms?: DerivationTransform[];
  trait_ids?: string[];
  trait_column?: DerivationTraitColumn | null;
};

export async function updateDerivation(
  id: string,
  patch: UpdateDerivationPatch,
): Promise<void> {
  const ds = getDataSource();
  const existing = await ds.query<{ id: string }>({
    sql: "SELECT id FROM config.derivations WHERE id = ? LIMIT 1",
    params: [id],
  });
  if (!existing[0]) throw new Error(`Derivation ${id} not found`);

  const sets: string[] = [];
  const params: unknown[] = [];
  const addSet = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ("source_tag" in patch) addSet("source_tag", patch.source_tag);
  if ("display_name" in patch)
    addSet("display_name", patch.display_name ?? null);
  if ("role" in patch) addSet("role", patch.role);
  if ("evidence_category" in patch)
    addSet("evidence_category", patch.evidence_category);
  if ("centric" in patch) addSet("centric", patch.centric);
  if ("trait_scope" in patch) addSet("trait_scope", patch.trait_scope);

  if (sets.length > 0) {
    sets.push("row_version = row_version + 1");
    sets.push("updated_at = now()");
    params.push(id);
    await ds.exec({
      sql: `UPDATE config.derivations SET ${sets.join(", ")} WHERE id = ?`,
      params,
    });
  }

  await replaceChildren(id, patch);
}

async function replaceChildren(
  derivationId: string,
  patch: {
    mappings?: DerivationMapping[];
    transforms?: DerivationTransform[];
    trait_ids?: string[];
    trait_column?: DerivationTraitColumn | null;
  },
): Promise<void> {
  const ds = getDataSource();

  if (patch.mappings !== undefined) {
    await ds.exec({
      sql: "DELETE FROM config.derivation_mappings WHERE derivation_id = ?",
      params: [derivationId],
    });
    for (const m of patch.mappings) {
      await ds.exec({
        sql:
          "INSERT INTO config.derivation_mappings " +
          "  (derivation_id, canonical_field, raw_column) VALUES (?, ?, ?)",
        params: [derivationId, m.canonical_field, m.raw_column],
      });
    }
  }

  if (patch.transforms !== undefined) {
    await ds.exec({
      sql: "DELETE FROM config.derivation_transforms WHERE derivation_id = ?",
      params: [derivationId],
    });
    for (const t of patch.transforms) {
      await ds.exec({
        sql:
          "INSERT INTO config.derivation_transforms " +
          "  (derivation_id, seq, type, params) VALUES (?, ?, ?, ?)",
        params: [derivationId, t.seq, t.type, JSON.stringify(t.params ?? {})],
      });
    }
  }

  if (patch.trait_ids !== undefined) {
    await ds.exec({
      sql: "DELETE FROM config.derivation_traits WHERE derivation_id = ?",
      params: [derivationId],
    });
    for (const traitId of patch.trait_ids) {
      await ds.exec({
        sql:
          "INSERT INTO config.derivation_traits (derivation_id, trait_id) " +
          "VALUES (?, ?) ON CONFLICT DO NOTHING",
        params: [derivationId, traitId],
      });
    }
  }

  if ("trait_column" in patch) {
    await ds.exec({
      sql:
        "DELETE FROM config.derivation_trait_column WHERE derivation_id = ?",
      params: [derivationId],
    });
    if (patch.trait_column) {
      await ds.exec({
        sql:
          "INSERT INTO config.derivation_trait_column " +
          "  (derivation_id, raw_column, trait_id_lookup) VALUES (?, ?, ?)",
        params: [
          derivationId,
          patch.trait_column.raw_column,
          patch.trait_column.trait_id_lookup ?? null,
        ],
      });
    }
  }
}

export async function removeDerivation(id: string): Promise<void> {
  const ds = getDataSource();
  await ds.exec({
    sql: "DELETE FROM config.derivation_mappings WHERE derivation_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.derivation_transforms WHERE derivation_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.derivation_traits WHERE derivation_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.derivation_trait_column WHERE derivation_id = ?",
    params: [id],
  });
  await ds.exec({
    sql: "DELETE FROM config.derivations WHERE id = ?",
    params: [id],
  });
}
