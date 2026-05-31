// Read/write the config.pegasus_settings singleton (id = 1). Window/merge
// defaults for loci, plus the derived-layer settings (gene reference URL +
// candidate biotypes).

import { getDataSource } from "./select";

export interface PegasusSettings {
  window_kb: number;
  merge_distance_kb: number;
  gene_reference_url: string | null;
  candidate_gene_biotypes: string | null;
}

export async function getPegasusSettings(): Promise<PegasusSettings> {
  const ds = getDataSource();
  const [row] = await ds.query<{
    window_kb: number;
    merge_distance_kb: number;
    gene_reference_url: string | null;
    candidate_gene_biotypes: string | null;
  }>({
    sql:
      "SELECT window_kb, merge_distance_kb, gene_reference_url, " +
      "candidate_gene_biotypes FROM config.pegasus_settings WHERE id = 1",
  });
  return {
    window_kb: Number(row?.window_kb ?? 500),
    merge_distance_kb: Number(row?.merge_distance_kb ?? 100),
    gene_reference_url: row?.gene_reference_url ?? null,
    candidate_gene_biotypes: row?.candidate_gene_biotypes ?? null,
  };
}

export type PegasusSettingsPatch = Partial<
  Pick<
    PegasusSettings,
    | "window_kb"
    | "merge_distance_kb"
    | "gene_reference_url"
    | "candidate_gene_biotypes"
  >
>;

export async function updatePegasusSettings(
  patch: PegasusSettingsPatch,
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ("window_kb" in patch) add("window_kb", patch.window_kb);
  if ("merge_distance_kb" in patch)
    add("merge_distance_kb", patch.merge_distance_kb);
  if ("gene_reference_url" in patch)
    add("gene_reference_url", patch.gene_reference_url || null);
  if ("candidate_gene_biotypes" in patch)
    add("candidate_gene_biotypes", patch.candidate_gene_biotypes || null);
  if (sets.length === 0) return;
  // Stamp who changed settings (surfaces in the Activity feed) + bump version.
  add("last_edited_by", actor);
  sets.push("row_version = row_version + 1");
  sets.push("updated_at = now()");
  await ds.exec({
    sql: `UPDATE config.pegasus_settings SET ${sets.join(", ")} WHERE id = 1`,
    params,
  });
}
