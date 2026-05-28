// Source-level transform ops. Transforms clean the raw table once and are
// shared by all of a source's mappings (config.source_transforms). Same DSL
// as before, compiled to SQL by transform/compile.ts.

import { getDataSource } from "./select";
import { bumpSourceAudit } from "./sourceOps";
import type { ConfigSourceTransform } from "../api/types";

type TransformRow = {
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

export async function listSourceTransforms(
  sourceId: string,
): Promise<ConfigSourceTransform[]> {
  const ds = getDataSource();
  const rows = await ds.query<TransformRow>({
    sql:
      "SELECT seq, type, params FROM config.source_transforms " +
      "WHERE source_id = ? ORDER BY seq",
    params: [sourceId],
  });
  return rows.map((t) => ({
    seq: Number(t.seq),
    type: t.type,
    params: parseJson(t.params),
  }));
}

/** Replace a source's entire transform pipeline. Re-sequences from 0 in the
 *  given order so callers don't have to manage `seq`. Bumps the parent
 *  source's `last_edited_by` + `updated_at` so the source audit reflects
 *  the pipeline change (no per-step audit — transforms are replaced as a
 *  unit, the actor lives on the source row). */
export async function replaceSourceTransforms(
  sourceId: string,
  transforms: Array<Pick<ConfigSourceTransform, "type" | "params">>,
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  await ds.exec({
    sql: "DELETE FROM config.source_transforms WHERE source_id = ?",
    params: [sourceId],
  });
  let seq = 0;
  for (const t of transforms) {
    await ds.exec({
      sql:
        "INSERT INTO config.source_transforms " +
        "  (source_id, seq, type, params) VALUES (?, ?, ?, ?)",
      params: [sourceId, seq, t.type, JSON.stringify(t.params ?? {})],
    });
    seq += 1;
  }
  await bumpSourceAudit(sourceId, actor);
}
