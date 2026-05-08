// Study config write operations against config.study_configs +
// config.study_traits + config.study_transformations. Mirrors sourceOps.ts.
//
// Phase 2 of the DB-first plan introduces only insertStudy for now — the
// schema-driven NewStudyForm uses it. listStudies / getStudy / patchStudy
// land alongside a per-study editor in a follow-up.

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
