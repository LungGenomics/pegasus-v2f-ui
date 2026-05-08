// Source import pipeline. Loads a source's raw bytes, registers them with
// DuckDB-WASM, applies the transform DSL via the SQL compiler, and writes
// the result to a raw_<source_id_short> table.
//
// Evidence routing (writing into the unified `evidence` table per the
// source's evidence_blocks) is a separate step — pending in a follow-up.

import type {
  V2fSourceConfig,
  V2fEvidenceBlock,
  TransformConfigEntry,
} from "../../api/types";
import { getDataSource } from "../select";
import { compileTransformPipeline } from "../transform/compile";
import { configReads } from "../queries/configRead";
import { loadSource } from "./loader";
import { loadAllEvidenceBlocks, type EvidenceBlock } from "./evidence";

/** First 8 chars of a UUID, sanitized — used as a stable, rename-safe
 *  suffix for raw_<...> tables. Keeps us from quoting/escaping concerns. */
function rawTableNameForSourceId(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_]/g, "");
  return `raw_${safe.slice(0, 8)}`;
}

export type ImportResult = {
  source_id: string;
  raw_table: string;
  rows: number;
  evidence_rows: number;
  evidence_per_block: Array<{ source_tag: string; rows: number }>;
};

export async function importSource(
  source: V2fSourceConfig,
): Promise<ImportResult> {
  const ds = getDataSource();

  // Look up source_id for the raw table name.
  const rows = await ds.query<{ id: string }>(
    configReads.sourceByName(source.name),
  );
  const sourceId = rows[0]?.id;
  if (!sourceId) {
    throw new Error(
      `Source '${source.name}' is not in config.source_configs — add it first.`,
    );
  }
  const rawTable = rawTableNameForSourceId(sourceId);

  // If any transform uses map_gene_id, ensure the HGNC mapping table is
  // loaded first. Idempotent — hasGeneMapping() short-circuits when present.
  const transforms = (source.transformations ?? []) as TransformConfigEntry[];
  const usesGeneMap = transforms.some((t) => t.type === "map_gene_id");
  if (usesGeneMap) {
    const { hasGeneMapping, loadGeneMapping } = await import("./gene-mapping");
    if (!(await hasGeneMapping())) {
      await loadGeneMapping();
    }
  }

  // Phase 1: load raw bytes and register with DuckDB-WASM.
  const loaded = await loadSource(source);
  const m = await import("../adapters/duckdb-wasm");
  await m.registerSourceBytes(loaded.registerAs, loaded.bytes);

  try {
    // Phase 2: compile transforms over the read expression and write the
    // result into a raw_<id> table. CREATE OR REPLACE so a re-import
    // overwrites cleanly.
    const compiled = compileTransformPipeline(transforms, loaded.readExpr, {
      sourceIsSql: true,
    });
    await ds.exec({
      sql: `CREATE OR REPLACE TABLE main.${rawTable} AS ${compiled}`,
    });
  } finally {
    // Drop the in-memory registration so we don't leak buffers across
    // multiple imports in the same session.
    await m.dropRegisteredFile(loaded.registerAs);
  }

  // Phase 3: count raw rows.
  const [count] = await ds.query<{ n: number }>({
    sql: `SELECT COUNT(*) AS n FROM main.${rawTable}`,
  });
  const n = Number(count?.n ?? 0);

  // Phase 4: route evidence blocks (if any) into the unified evidence table.
  const evidenceBlocks = (source.evidence ?? []) as V2fEvidenceBlock[];
  const evidenceResult =
    evidenceBlocks.length > 0
      ? await loadAllEvidenceBlocks(
          evidenceBlocks.map((b) => ({
            source_tag: String(b.source_tag),
            evidence_category: String(b.category),
            ...(b.role ? { role: String(b.role) } : {}),
            ...(b.centric ? { centric: String(b.centric) } : {}),
            fields: (b.fields as Record<string, unknown>) ?? {},
            ...(Array.isArray((b as unknown as { traits?: unknown }).traits)
              ? { traits: (b as unknown as { traits: string[] }).traits }
              : {}),
          })) as EvidenceBlock[],
          rawTable,
        )
      : { rows: 0, per_block: [] };

  return {
    source_id: sourceId,
    raw_table: rawTable,
    rows: n,
    evidence_rows: evidenceResult.rows,
    evidence_per_block: evidenceResult.per_block,
  };
}
