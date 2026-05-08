// Study config write operations against config.study_configs +
// config.study_traits + config.study_transformations. Mirrors sourceOps.ts.

import { getDataSource } from "./select";
import type { V2fStudyConfig } from "../api/types";

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
}
