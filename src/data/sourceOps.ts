// Source-management read+write operations against the new config.* schema.
// Callers think in V2fSourceConfig objects; this module hides the relational
// shape behind a uniform getSource / listSources / patchSourceConfig /
// removeSource API.

import { getDataSource } from "./select";
import { configReads } from "./queries/configRead";
import { writes, rawTableName } from "./queries/writes";
import type {
  V2fSourceConfig,
  V2fEvidenceBlock,
  TransformConfigEntry,
} from "../api/types";

type SourceConfigRow = {
  id: string;
  name: string;
  source_type: string;
  url: string | null;
  sheet: string | null;
  skip_rows: number;
  display_name: string | null;
  description: string | null;
  data_type: string | null;
  gene_column: string | null;
  include_in_search: boolean;
  row_version: number;
};

type TransformRow = {
  id: string;
  seq: number;
  type: string;
  params: string | Record<string, unknown> | null;
};

type EvidenceBlockRow = {
  id: string;
  source_tag: string;
  evidence_category: string;
  role: string | null;
  centric: string | null;
  fields: string | Record<string, unknown> | null;
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

function rowToSource(
  row: SourceConfigRow,
  transforms: TransformRow[],
  blocks: EvidenceBlockRow[],
): V2fSourceConfig {
  const out: V2fSourceConfig = {
    name: row.name,
    source_type: row.source_type,
  };
  if (row.url != null) out.url = row.url;
  if (row.sheet != null) out.sheet = row.sheet;
  if (row.skip_rows != null && row.skip_rows !== 0) out.skip_rows = row.skip_rows;
  if (row.display_name != null) out.display_name = row.display_name;
  if (row.description != null) {
    (out as { description?: string }).description = row.description;
  }
  if (row.data_type != null) {
    (out as { data_type?: string }).data_type = row.data_type;
  }
  if (row.gene_column != null) out.gene_column = row.gene_column;
  if (row.include_in_search === false) {
    (out as { include_in_search?: boolean }).include_in_search = false;
  }
  if (transforms.length > 0) {
    out.transformations = transforms.map(
      (t): TransformConfigEntry => ({
        type: t.type,
        ...parseJson(t.params),
      }) as TransformConfigEntry,
    );
  }
  if (blocks.length > 0) {
    out.evidence = blocks.map((b): V2fEvidenceBlock => {
      const fields = parseJson(b.fields);
      return {
        source_tag: b.source_tag,
        category: b.evidence_category,
        ...(b.role != null ? { role: b.role } : {}),
        ...(b.centric != null ? { centric: b.centric } : {}),
        ...fields,
      } as V2fEvidenceBlock;
    });
  }
  return out;
}

async function fetchChildren(
  sourceId: string,
): Promise<{ transforms: TransformRow[]; blocks: EvidenceBlockRow[] }> {
  const ds = getDataSource();
  const [transforms, blocks] = await Promise.all([
    ds.query<TransformRow>(configReads.transformsForSource(sourceId)),
    ds.query<EvidenceBlockRow>(configReads.evidenceBlocksForSource(sourceId)),
  ]);
  return { transforms, blocks };
}

// --- READS ---

export async function listSources(): Promise<V2fSourceConfig[]> {
  const ds = getDataSource();
  const rows = await ds.query<SourceConfigRow>(configReads.allSources());
  return Promise.all(
    rows.map(async (row) => {
      const { transforms, blocks } = await fetchChildren(row.id);
      return rowToSource(row, transforms, blocks);
    }),
  );
}

export async function getSource(
  name: string,
): Promise<V2fSourceConfig | null> {
  const ds = getDataSource();
  const rows = await ds.query<SourceConfigRow>(configReads.sourceByName(name));
  const row = rows[0];
  if (!row) return null;
  const { transforms, blocks } = await fetchChildren(row.id);
  return rowToSource(row, transforms, blocks);
}

// --- WRITES ---

export async function patchSourceConfig(
  name: string,
  newSource: V2fSourceConfig,
): Promise<void> {
  const ds = getDataSource();
  const rows = await ds.query<{ id: string; row_version: number }>(
    configReads.sourceByName(name),
  );
  if (!rows.length) {
    await insertSource(newSource);
    return;
  }
  const sourceId = rows[0]!.id;

  await ds.exec({
    sql:
      `UPDATE config.source_configs SET ` +
      `  name = ?, source_type = ?, url = ?, sheet = ?, skip_rows = ?, ` +
      `  display_name = ?, description = ?, data_type = ?, gene_column = ?, ` +
      `  include_in_search = ?, row_version = row_version + 1, updated_at = now() ` +
      `WHERE id = ?`,
    params: [
      newSource.name,
      newSource.source_type,
      newSource.url ?? null,
      newSource.sheet ?? null,
      newSource.skip_rows ?? 0,
      newSource.display_name ?? null,
      (newSource as { description?: string }).description ?? null,
      (newSource as { data_type?: string }).data_type ?? null,
      newSource.gene_column ?? null,
      (newSource as { include_in_search?: boolean }).include_in_search ?? true,
      sourceId,
    ],
  });

  await ds.exec({
    sql: "DELETE FROM config.source_transformations WHERE source_id = ?",
    params: [sourceId],
  });
  const transforms = (newSource.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.source_transformations ` +
        `  (source_id, seq, type, params) VALUES (?, ?, ?, ?)`,
      params: [sourceId, i, type, JSON.stringify(params)],
    });
  }

  await ds.exec({
    sql: "DELETE FROM config.source_evidence_blocks WHERE source_id = ?",
    params: [sourceId],
  });
  const evidence = (newSource.evidence ?? []) as V2fEvidenceBlock[];
  for (const block of evidence) {
    const { source_tag, category, role, centric, fields, ...rest } = block;
    const fieldsJson = { ...(fields ?? {}), ...rest };
    await ds.exec({
      sql:
        `INSERT INTO config.source_evidence_blocks ` +
        `  (source_id, source_tag, evidence_category, role, centric, fields) ` +
        `VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        sourceId,
        source_tag,
        category,
        role ?? null,
        centric ?? null,
        JSON.stringify(fieldsJson),
      ],
    });
  }
}

export async function insertSource(source: V2fSourceConfig): Promise<string> {
  const ds = getDataSource();
  const idRows = await ds.query<{ id: string }>({
    sql:
      `INSERT INTO config.source_configs ` +
      `  (name, source_type, url, sheet, skip_rows, display_name, ` +
      `   description, data_type, gene_column, include_in_search) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    params: [
      source.name,
      source.source_type,
      source.url ?? null,
      source.sheet ?? null,
      source.skip_rows ?? 0,
      source.display_name ?? null,
      (source as { description?: string }).description ?? null,
      (source as { data_type?: string }).data_type ?? null,
      source.gene_column ?? null,
      (source as { include_in_search?: boolean }).include_in_search ?? true,
    ],
  });
  const sourceId = idRows[0]!.id;

  const transforms = (source.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.source_transformations ` +
        `  (source_id, seq, type, params) VALUES (?, ?, ?, ?)`,
      params: [sourceId, i, type, JSON.stringify(params)],
    });
  }

  const evidence = (source.evidence ?? []) as V2fEvidenceBlock[];
  for (const block of evidence) {
    const { source_tag, category, role, centric, fields, ...rest } = block;
    const fieldsJson = { ...(fields ?? {}), ...rest };
    await ds.exec({
      sql:
        `INSERT INTO config.source_evidence_blocks ` +
        `  (source_id, source_tag, evidence_category, role, centric, fields) ` +
        `VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        sourceId,
        source_tag,
        category,
        role ?? null,
        centric ?? null,
        JSON.stringify(fieldsJson),
      ],
    });
  }
  return sourceId;
}

export async function removeSource(name: string): Promise<void> {
  const ds = getDataSource();
  const rows = await ds.query<SourceConfigRow>(configReads.sourceByName(name));
  const row = rows[0];
  if (!row) return;
  const sourceId = row.id;

  const blocks = await ds.query<EvidenceBlockRow>(
    configReads.evidenceBlocksForSource(sourceId),
  );

  // Drop the raw imported table for this source. Use UUID-based name to be
  // rename-safe — once the import pipeline is on board, builds will write
  // raw_<sourceId> instead of raw_<name>.
  await ds.exec(writes.dropTable(rawTableName(sourceId)));

  for (const block of blocks) {
    const tag = block.source_tag;
    if (!tag) continue;
    await ds.exec(writes.deleteScoredEvidenceBySourceTag(tag));
    await ds.exec(writes.deleteEvidenceBySourceTag(tag));
    if (block.role === "locus_definition") {
      await ds.exec(writes.deleteOrphanedScoredEvidence(tag));
      await ds.exec(writes.deleteOrphanedLoci(tag));
      await ds.exec(writes.deleteStudiesBySourceTag(tag));
    }
    await ds.exec(writes.deleteDataSourceBySourceTag(tag));
  }

  // Delete children first — DuckDB doesn't support FK CASCADE, so we have
  // to clear referencing rows before the parent.
  await ds.exec({
    sql: "DELETE FROM config.source_transformations WHERE source_id = ?",
    params: [sourceId],
  });
  await ds.exec({
    sql: "DELETE FROM config.source_evidence_blocks WHERE source_id = ?",
    params: [sourceId],
  });
  await ds.exec({
    sql: "DELETE FROM config.source_configs WHERE id = ?",
    params: [sourceId],
  });
}
