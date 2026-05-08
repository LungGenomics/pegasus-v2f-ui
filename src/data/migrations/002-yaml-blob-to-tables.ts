import yaml from "js-yaml";
import type { DataSource } from "../types";
import type { Migration } from "./types";
import type {
  V2fConfig,
  V2fSourceConfig,
  V2fStudyConfig,
  V2fEvidenceBlock,
  TransformConfigEntry,
} from "../../api/types";

// Port the YAML blob in main._pegasus_meta WHERE key='config' into
// config.* tables. Idempotent: if the blob isn't present (already migrated
// or fresh DB), this is a no-op.

const apply = async (ds: DataSource): Promise<void> => {
  // Read current YAML blob if present
  let yamlText: string | null = null;
  try {
    const rows = await ds.query<{ value: string }>({
      sql: "SELECT value FROM main._pegasus_meta WHERE key = 'config'",
    });
    if (rows.length > 0 && rows[0]) {
      yamlText = rows[0].value;
    }
  } catch {
    // _pegasus_meta might not exist on a brand-new DB. Nothing to migrate.
    return;
  }

  if (!yamlText) return;

  let config: V2fConfig;
  try {
    config = (yaml.load(yamlText) as V2fConfig) ?? {};
  } catch (err) {
    console.warn("Could not parse _pegasus_meta.config YAML:", err);
    return;
  }

  // Sources
  for (const source of config.data_sources ?? []) {
    await insertSourceConfig(ds, source);
  }

  // Studies
  for (const study of config.pegasus?.study ?? []) {
    await insertStudyConfig(ds, study);
  }

  // PEGASUS settings
  const locDef = config.pegasus?.locus_definition;
  if (locDef) {
    await ds.exec({
      sql:
        `UPDATE config.pegasus_settings ` +
        `SET window_kb = COALESCE(?, window_kb), ` +
        `    merge_distance_kb = COALESCE(?, merge_distance_kb), ` +
        `    updated_at = now() ` +
        `WHERE id = 1`,
      params: [locDef.window_kb ?? null, locDef.merge_distance_kb ?? null],
    });
  }

  // Mark imported, drop the blob
  await ds.exec({
    sql:
      `UPDATE config.config_meta ` +
      `SET last_imported_at = now(), exported_from_yaml = '_pegasus_meta.config' ` +
      `WHERE id = 1`,
  });
  await ds.exec({
    sql: "DELETE FROM main._pegasus_meta WHERE key = 'config'",
  });
};

async function insertSourceConfig(
  ds: DataSource,
  source: V2fSourceConfig,
): Promise<void> {
  // Insert the source row, RETURNING id (DuckDB and Postgres both support).
  const idRows = await ds.query<{ id: string }>({
    sql:
      `INSERT INTO config.source_configs ` +
      `  (name, source_type, url, sheet, skip_rows, display_name, ` +
      `   description, data_type, gene_column, include_in_search) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
      `RETURNING id`,
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
  const sourceId = idRows[0]?.id;
  if (!sourceId) return;

  // Transformations
  const transforms = (source.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.source_transformations ` +
        `  (source_id, seq, type, params) ` +
        `VALUES (?, ?, ?, ?)`,
      params: [sourceId, i, type, JSON.stringify(params)],
    });
  }

  // Evidence blocks
  const evidence = (source.evidence ?? []) as V2fEvidenceBlock[];
  for (const block of evidence) {
    const { source_tag, category, role, centric, fields, ...rest } = block;
    // The `fields` blob plus any other unknown keys go into the JSON params
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

async function insertStudyConfig(
  ds: DataSource,
  study: V2fStudyConfig,
): Promise<void> {
  const idRows = await ds.query<{ id: string }>({
    sql:
      `INSERT INTO config.study_configs ` +
      `  (id_prefix, gwas_source, ancestry, sample_size, doi, year, ` +
      `   loci_source, loci_sheet, loci_skip, gene_column, ` +
      `   sentinel_column, pvalue_column, rsid_column) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
      `RETURNING id`,
    params: [
      study.id_prefix,
      study.gwas_source ?? null,
      study.ancestry ?? null,
      study.sample_size ?? null,
      study.doi ?? null,
      study.year ?? null,
      study.loci_source ?? null,
      study.loci_sheet ?? null,
      study.loci_skip ?? 0,
      study.gene_column ?? null,
      study.sentinel_column ?? null,
      study.pvalue_column ?? null,
      study.rsid_column ?? null,
    ],
  });
  const studyId = idRows[0]?.id;
  if (!studyId) return;

  for (const trait of study.traits ?? []) {
    await ds.exec({
      sql:
        `INSERT INTO config.study_traits (study_id, trait) ` +
        `VALUES (?, ?) ON CONFLICT DO NOTHING`,
      params: [studyId, trait],
    });
  }

  const sTransforms = (study.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < sTransforms.length; i++) {
    const t = sTransforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.study_transformations ` +
        `  (study_id, seq, type, params) ` +
        `VALUES (?, ?, ?, ?)`,
      params: [studyId, i, type, JSON.stringify(params)],
    });
  }
}

export const migration: Migration = {
  version: 2,
  name: "yaml_blob_to_tables",
  apply,
};
