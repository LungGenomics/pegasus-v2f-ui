// Study config read+write operations against config.study_configs +
// config.study_traits + config.study_transformations. Mirrors sourceOps.ts.

import { getDataSource } from "./select";
import { configReads } from "./queries/configRead";
import type { TransformConfigEntry, V2fStudyConfig } from "../api/types";

type StudyConfigRow = {
  id: string;
  id_prefix: string;
  display_name: string | null;
  description: string | null;
  gwas_source: string | null;
  ancestry: string | null;
  sample_size: number | null;
  doi: string | null;
  year: number | null;
  loci_source: string | null;
  loci_sheet: string | null;
  loci_skip: number;
  gene_column: string | null;
  sentinel_column: string | null;
  pvalue_column: string | null;
  rsid_column: string | null;
  row_version: number;
};

type StudyTransformRow = {
  id: string;
  seq: number;
  type: string;
  params: string | Record<string, unknown> | null;
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

function rowToStudy(
  row: StudyConfigRow,
  traits: string[],
  transforms: StudyTransformRow[],
): V2fStudyConfig {
  const out: V2fStudyConfig = {
    id_prefix: row.id_prefix,
    traits,
  };
  if (row.display_name != null) {
    (out as { display_name?: string }).display_name = row.display_name;
  }
  if (row.description != null) {
    (out as { description?: string }).description = row.description;
  }
  if (row.gwas_source != null) out.gwas_source = row.gwas_source;
  if (row.ancestry != null) out.ancestry = row.ancestry;
  if (row.sample_size != null) {
    out.sample_size = Number(row.sample_size);
  }
  if (row.doi != null) out.doi = row.doi;
  if (row.year != null) out.year = Number(row.year);
  if (row.loci_source != null) out.loci_source = row.loci_source;
  if (row.loci_sheet != null) out.loci_sheet = row.loci_sheet;
  if (row.loci_skip != null && row.loci_skip !== 0) {
    out.loci_skip = Number(row.loci_skip);
  }
  if (row.gene_column != null) out.gene_column = row.gene_column;
  if (row.sentinel_column != null) out.sentinel_column = row.sentinel_column;
  if (row.pvalue_column != null) out.pvalue_column = row.pvalue_column;
  if (row.rsid_column != null) out.rsid_column = row.rsid_column;
  if (transforms.length > 0) {
    out.transformations = transforms.map(
      (t): TransformConfigEntry => ({
        type: t.type,
        ...parseJson(t.params),
      }) as TransformConfigEntry,
    );
  }
  return out;
}

async function fetchStudyChildren(
  studyId: string,
): Promise<{ traits: string[]; transforms: StudyTransformRow[] }> {
  const ds = getDataSource();
  const [traitRows, transforms] = await Promise.all([
    ds.query<{ trait: string }>(configReads.traitsForStudy(studyId)),
    ds.query<StudyTransformRow>(configReads.transformsForStudy(studyId)),
  ]);
  return { traits: traitRows.map((r) => r.trait), transforms };
}

export async function listStudies(): Promise<V2fStudyConfig[]> {
  const ds = getDataSource();
  const rows = await ds.query<StudyConfigRow>(configReads.allStudies());
  return Promise.all(
    rows.map(async (row) => {
      const { traits, transforms } = await fetchStudyChildren(row.id);
      return rowToStudy(row, traits, transforms);
    }),
  );
}

export async function getStudy(
  idPrefix: string,
): Promise<V2fStudyConfig | null> {
  const ds = getDataSource();
  const rows = await ds.query<StudyConfigRow>(
    configReads.studyByIdPrefix(idPrefix),
  );
  const row = rows[0];
  if (!row) return null;
  const { traits, transforms } = await fetchStudyChildren(row.id);
  return rowToStudy(row, traits, transforms);
}

export async function insertStudy(study: V2fStudyConfig): Promise<string> {
  const ds = getDataSource();

  // Phase 1: insert the parent row, return id.
  const [row] = await ds.query<{ id: string }>({
    sql:
      `INSERT INTO config.study_configs ` +
      `  (id_prefix, display_name, description, gwas_source, ancestry, ` +
      `   sample_size, doi, year, loci_source, loci_sheet, loci_skip, ` +
      `   gene_column, sentinel_column, pvalue_column, rsid_column) ` +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    params: [
      study.id_prefix,
      (study as { display_name?: string }).display_name ?? null,
      (study as { description?: string }).description ?? null,
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
  if (!row) {
    throw new Error("INSERT into config.study_configs returned no rows");
  }
  const studyId = row.id;

  // Phase 2: insert traits.
  const traits = study.traits ?? [];
  for (const trait of traits) {
    if (!trait || typeof trait !== "string") continue;
    await ds.exec({
      sql:
        `INSERT INTO config.study_traits (study_id, trait) ` +
        `VALUES (?, ?) ON CONFLICT DO NOTHING`,
      params: [studyId, trait],
    });
  }

  // Phase 3: insert transformations.
  const transforms = (study.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.study_transformations ` +
        `  (study_id, seq, type, params) VALUES (?, ?, ?, ?)`,
      params: [studyId, i, type, JSON.stringify(params)],
    });
  }

  return studyId;
}

/** Update a study's parent row + replace its traits. Looked up by id_prefix
 *  (which doubles as the user-facing identifier in URLs and stack views). */
export async function patchStudyConfig(
  idPrefix: string,
  newStudy: V2fStudyConfig,
): Promise<void> {
  const ds = getDataSource();
  const [row] = await ds.query<{ id: string }>({
    sql: "SELECT id FROM config.study_configs WHERE id_prefix = ? LIMIT 1",
    params: [idPrefix],
  });
  if (!row) {
    // Doesn't exist — fall through to insert (mirrors patchSourceConfig).
    await insertStudy(newStudy);
    return;
  }
  const studyId = row.id;

  await ds.exec({
    sql:
      `UPDATE config.study_configs SET ` +
      `  id_prefix = ?, display_name = ?, description = ?, gwas_source = ?, ` +
      `  ancestry = ?, sample_size = ?, doi = ?, year = ?, ` +
      `  loci_source = ?, loci_sheet = ?, loci_skip = ?, ` +
      `  gene_column = ?, sentinel_column = ?, pvalue_column = ?, rsid_column = ?, ` +
      `  row_version = row_version + 1, updated_at = now() ` +
      `WHERE id = ?`,
    params: [
      newStudy.id_prefix,
      (newStudy as { display_name?: string }).display_name ?? null,
      (newStudy as { description?: string }).description ?? null,
      newStudy.gwas_source ?? null,
      newStudy.ancestry ?? null,
      newStudy.sample_size ?? null,
      newStudy.doi ?? null,
      newStudy.year ?? null,
      newStudy.loci_source ?? null,
      newStudy.loci_sheet ?? null,
      newStudy.loci_skip ?? 0,
      newStudy.gene_column ?? null,
      newStudy.sentinel_column ?? null,
      newStudy.pvalue_column ?? null,
      newStudy.rsid_column ?? null,
      studyId,
    ],
  });

  // Replace traits.
  await ds.exec({
    sql: "DELETE FROM config.study_traits WHERE study_id = ?",
    params: [studyId],
  });
  for (const trait of newStudy.traits ?? []) {
    if (!trait || typeof trait !== "string") continue;
    await ds.exec({
      sql:
        `INSERT INTO config.study_traits (study_id, trait) ` +
        `VALUES (?, ?) ON CONFLICT DO NOTHING`,
      params: [studyId, trait],
    });
  }

  // Replace transformations.
  await ds.exec({
    sql: "DELETE FROM config.study_transformations WHERE study_id = ?",
    params: [studyId],
  });
  const transforms = (newStudy.transformations ?? []) as TransformConfigEntry[];
  for (let i = 0; i < transforms.length; i++) {
    const t = transforms[i]!;
    const { type, ...params } = t;
    await ds.exec({
      sql:
        `INSERT INTO config.study_transformations ` +
        `  (study_id, seq, type, params) VALUES (?, ?, ?, ?)`,
      params: [studyId, i, type, JSON.stringify(params)],
    });
  }
}
