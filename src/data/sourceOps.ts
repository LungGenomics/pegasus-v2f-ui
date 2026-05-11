// Source-level read+write ops against the redesigned schema (plan
// 2026-05-11-config-redesign-web-first.md). A Source is just the raw
// data file + metadata; transformations and column mappings live on
// derivations (see derivationOps.ts).

import { getDataSource } from "./select";
import type { ConfigSource, SourceCitation } from "../api/types";

// --- Row shapes returned by raw SELECTs ---

type SourceRow = {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  source_type: string;
  url: string | null;
  sheet: string | null;
  skip_rows: number | null;
  row_version: number;
  created_at: string | null;
  updated_at: string | null;
};

type CitationRow = {
  source_id: string;
  gwas_source: string | null;
  ancestry: string | null;
  sample_size: number | null;
  doi: string | null;
  year: number | null;
  pubmed_id: string | null;
  updated_at: string | null;
};

// --- Internal helpers ---

function rowToSource(
  row: SourceRow,
  citation: CitationRow | null,
  traitIds: string[],
): ConfigSource {
  const out: ConfigSource = {
    id: row.id,
    name: row.name,
    source_type: row.source_type,
    row_version: Number(row.row_version),
  };
  if (row.display_name != null) out.display_name = row.display_name;
  if (row.description != null) out.description = row.description;
  if (row.url != null) out.url = row.url;
  if (row.sheet != null) out.sheet = row.sheet;
  if (row.skip_rows != null && row.skip_rows !== 0) {
    out.skip_rows = Number(row.skip_rows);
  }
  if (row.created_at != null) out.created_at = row.created_at;
  if (row.updated_at != null) out.updated_at = row.updated_at;
  if (citation) out.citation = rowToCitation(citation);
  if (traitIds.length > 0) out.trait_ids = traitIds;
  return out;
}

function rowToCitation(row: CitationRow): SourceCitation {
  const out: SourceCitation = { source_id: row.source_id };
  if (row.gwas_source != null) out.gwas_source = row.gwas_source;
  if (row.ancestry != null) out.ancestry = row.ancestry;
  if (row.sample_size != null) out.sample_size = Number(row.sample_size);
  if (row.doi != null) out.doi = row.doi;
  if (row.year != null) out.year = Number(row.year);
  if (row.pubmed_id != null) out.pubmed_id = row.pubmed_id;
  if (row.updated_at != null) out.updated_at = row.updated_at;
  return out;
}

async function fetchSourceChildren(
  sourceId: string,
): Promise<{ citation: CitationRow | null; traitIds: string[] }> {
  const ds = getDataSource();
  const [citationRows, traitRows] = await Promise.all([
    ds.query<CitationRow>({
      sql:
        "SELECT source_id, gwas_source, ancestry, sample_size, doi, year, " +
        "       pubmed_id, updated_at " +
        "FROM config.source_citation WHERE source_id = ? LIMIT 1",
      params: [sourceId],
    }),
    ds.query<{ trait_id: string }>({
      sql:
        "SELECT trait_id FROM config.source_traits WHERE source_id = ?",
      params: [sourceId],
    }),
  ]);
  return {
    citation: citationRows[0] ?? null,
    traitIds: traitRows.map((r) => r.trait_id),
  };
}

// --- READS ---

export async function listSources(): Promise<ConfigSource[]> {
  const ds = getDataSource();
  const rows = await ds.query<SourceRow>({
    sql:
      "SELECT id, name, display_name, description, source_type, url, sheet, " +
      "       skip_rows, row_version, created_at, updated_at " +
      "FROM config.sources ORDER BY name",
  });
  return Promise.all(
    rows.map(async (row) => {
      const { citation, traitIds } = await fetchSourceChildren(row.id);
      return rowToSource(row, citation, traitIds);
    }),
  );
}

export async function getSource(name: string): Promise<ConfigSource | null> {
  const ds = getDataSource();
  const rows = await ds.query<SourceRow>({
    sql:
      "SELECT id, name, display_name, description, source_type, url, sheet, " +
      "       skip_rows, row_version, created_at, updated_at " +
      "FROM config.sources WHERE name = ? LIMIT 1",
    params: [name],
  });
  const row = rows[0];
  if (!row) return null;
  const { citation, traitIds } = await fetchSourceChildren(row.id);
  return rowToSource(row, citation, traitIds);
}

export async function getSourceById(
  id: string,
): Promise<ConfigSource | null> {
  const ds = getDataSource();
  const rows = await ds.query<SourceRow>({
    sql:
      "SELECT id, name, display_name, description, source_type, url, sheet, " +
      "       skip_rows, row_version, created_at, updated_at " +
      "FROM config.sources WHERE id = ? LIMIT 1",
    params: [id],
  });
  const row = rows[0];
  if (!row) return null;
  const { citation, traitIds } = await fetchSourceChildren(row.id);
  return rowToSource(row, citation, traitIds);
}

// --- WRITES ---

export interface InsertSourceInput {
  name: string;
  source_type: string;
  display_name?: string;
  description?: string;
  url?: string;
  sheet?: string;
  skip_rows?: number;
  citation?: Omit<SourceCitation, "source_id" | "updated_at">;
  trait_ids?: string[];
}

export async function insertSource(
  input: InsertSourceInput,
): Promise<string> {
  const ds = getDataSource();
  const [row] = await ds.query<{ id: string }>({
    sql:
      "INSERT INTO config.sources " +
      "  (name, display_name, description, source_type, url, sheet, skip_rows) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    params: [
      input.name,
      input.display_name ?? null,
      input.description ?? null,
      input.source_type,
      input.url ?? null,
      input.sheet ?? null,
      input.skip_rows ?? 0,
    ],
  });
  if (!row) throw new Error("INSERT config.sources returned no rows");
  const sourceId = row.id;

  if (input.citation) {
    await upsertCitation(sourceId, input.citation);
  }
  if (input.trait_ids && input.trait_ids.length > 0) {
    for (const traitId of input.trait_ids) {
      await ds.exec({
        sql:
          "INSERT INTO config.source_traits (source_id, trait_id) " +
          "VALUES (?, ?) ON CONFLICT DO NOTHING",
        params: [sourceId, traitId],
      });
    }
  }
  return sourceId;
}

export type UpdateSourcePatch = Partial<
  Pick<
    ConfigSource,
    | "name"
    | "display_name"
    | "description"
    | "source_type"
    | "url"
    | "sheet"
    | "skip_rows"
  >
> & {
  citation?: Omit<SourceCitation, "source_id" | "updated_at"> | null;
  trait_ids?: string[];
};

export async function updateSource(
  name: string,
  patch: UpdateSourcePatch,
): Promise<void> {
  const ds = getDataSource();
  const existing = await ds.query<{ id: string }>({
    sql: "SELECT id FROM config.sources WHERE name = ? LIMIT 1",
    params: [name],
  });
  const sourceId = existing[0]?.id;
  if (!sourceId) {
    throw new Error(`Source '${name}' not found`);
  }

  // Build a dynamic SET clause so untouched fields keep their current
  // values. Each entry in `patch` becomes one column = ?.
  const sets: string[] = [];
  const params: unknown[] = [];
  const addSet = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ("name" in patch) addSet("name", patch.name);
  if ("display_name" in patch)
    addSet("display_name", patch.display_name ?? null);
  if ("description" in patch) addSet("description", patch.description ?? null);
  if ("source_type" in patch) addSet("source_type", patch.source_type);
  if ("url" in patch) addSet("url", patch.url ?? null);
  if ("sheet" in patch) addSet("sheet", patch.sheet ?? null);
  if ("skip_rows" in patch) addSet("skip_rows", patch.skip_rows ?? 0);

  if (sets.length > 0) {
    sets.push("row_version = row_version + 1");
    sets.push("updated_at = now()");
    params.push(sourceId);
    await ds.exec({
      sql: `UPDATE config.sources SET ${sets.join(", ")} WHERE id = ?`,
      params,
    });
  }

  if ("citation" in patch) {
    if (patch.citation === null) {
      await ds.exec({
        sql: "DELETE FROM config.source_citation WHERE source_id = ?",
        params: [sourceId],
      });
    } else if (patch.citation) {
      await upsertCitation(sourceId, patch.citation);
    }
  }

  if (patch.trait_ids !== undefined) {
    await ds.exec({
      sql: "DELETE FROM config.source_traits WHERE source_id = ?",
      params: [sourceId],
    });
    for (const traitId of patch.trait_ids) {
      await ds.exec({
        sql:
          "INSERT INTO config.source_traits (source_id, trait_id) " +
          "VALUES (?, ?) ON CONFLICT DO NOTHING",
        params: [sourceId, traitId],
      });
    }
  }
}

async function upsertCitation(
  sourceId: string,
  citation: Omit<SourceCitation, "source_id" | "updated_at">,
): Promise<void> {
  const ds = getDataSource();
  // 1:1 with config.sources, so delete+insert is the simplest write.
  await ds.exec({
    sql: "DELETE FROM config.source_citation WHERE source_id = ?",
    params: [sourceId],
  });
  await ds.exec({
    sql:
      "INSERT INTO config.source_citation " +
      "  (source_id, gwas_source, ancestry, sample_size, doi, year, pubmed_id) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [
      sourceId,
      citation.gwas_source ?? null,
      citation.ancestry ?? null,
      citation.sample_size ?? null,
      citation.doi ?? null,
      citation.year ?? null,
      citation.pubmed_id ?? null,
    ],
  });
}

export async function removeSource(name: string): Promise<void> {
  const ds = getDataSource();
  const existing = await ds.query<{ id: string }>({
    sql: "SELECT id FROM config.sources WHERE name = ? LIMIT 1",
    params: [name],
  });
  const sourceId = existing[0]?.id;
  if (!sourceId) return;

  // Manual cascade — DuckDB doesn't support ON DELETE CASCADE. Drop
  // derivation children before derivations, then source-level children
  // before the source row itself.
  const derivationIds = await ds.query<{ id: string }>({
    sql: "SELECT id FROM config.derivations WHERE source_id = ?",
    params: [sourceId],
  });
  for (const { id } of derivationIds) {
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
      sql:
        "DELETE FROM config.derivation_trait_column WHERE derivation_id = ?",
      params: [id],
    });
  }
  await ds.exec({
    sql: "DELETE FROM config.derivations WHERE source_id = ?",
    params: [sourceId],
  });
  await ds.exec({
    sql: "DELETE FROM config.source_traits WHERE source_id = ?",
    params: [sourceId],
  });
  await ds.exec({
    sql: "DELETE FROM config.source_citation WHERE source_id = ?",
    params: [sourceId],
  });

  // Drop raw table if any build has already happened.
  await ds.exec({
    sql: `DROP TABLE IF EXISTS main."${rawTableName(sourceId)}"`,
  });

  await ds.exec({
    sql: "DELETE FROM config.sources WHERE id = ?",
    params: [sourceId],
  });
}

/** UUID-safe identifier suffix. Hyphens in UUIDs would need quoting
 *  every place the raw table is referenced; collapse to underscores so
 *  the table name is a plain identifier. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Stable raw-table name for a source. Used by the build pipeline and
 *  by removeSource so we drop the right table. */
export function rawTableName(sourceId: string): string {
  return `raw_${sanitizeId(sourceId)}`;
}
