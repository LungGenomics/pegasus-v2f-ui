// Per-derivation routing — turns rows in main.raw_<source_id> into rows
// in main.evidence, tagged with the derivation's source_tag, category,
// role, and trait identity.
//
// One INSERT per derivation. Compiles transforms (DSL → SQL) once,
// applies the column mapping as a SELECT projection, then resolves
// trait_id either from constant `derivation.trait_ids` (CROSS JOIN
// against a VALUES list) or by looking up labels in `config.traits`
// (LEFT JOIN, unmapped rows keep trait_id = NULL).

import { getDataSource } from "../select";
import { rawTableName } from "../sourceOps";
import { findOrCreateByLabel, getTrait } from "../traitOps";
import { compileTransformPipeline } from "../transform/compile";
import type {
  ConfigDerivation,
  ConfigSource,
  ConfigTrait,
  DerivationTransform,
} from "../../api/types";

// --- Helpers ---

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function strLit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Canonical evidence-table columns and the SQL cast each accepts. */
const COLUMN_CASTS: Record<string, (rawCol: string) => string> = {
  gene_symbol: (c) => `CAST(${c} AS VARCHAR)`,
  chromosome: (c) => `CAST(${c} AS VARCHAR)`,
  position: (c) => `TRY_CAST(${c} AS BIGINT)`,
  rsid: (c) => `CAST(${c} AS VARCHAR)`,
  pvalue: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  effect_size: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  score: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  tissue: (c) => `CAST(${c} AS VARCHAR)`,
  cell_type: (c) => `CAST(${c} AS VARCHAR)`,
  ancestry: (c) => `CAST(${c} AS VARCHAR)`,
  sex: (c) => `CAST(${c} AS VARCHAR)`,
  evidence_stream: (c) => `CAST(${c} AS VARCHAR)`,
};

const MAIN_EVIDENCE_DDL = `CREATE TABLE IF NOT EXISTS main.evidence (
  source_tag         VARCHAR,
  evidence_category  VARCHAR,
  role               VARCHAR,
  source_id          UUID,
  derivation_id      UUID,
  gene_symbol        VARCHAR,
  chromosome         VARCHAR,
  position           BIGINT,
  rsid               VARCHAR,
  trait              VARCHAR,
  trait_id           UUID,
  pvalue             DOUBLE,
  effect_size        DOUBLE,
  score              DOUBLE,
  tissue             VARCHAR,
  cell_type          VARCHAR,
  ancestry           VARCHAR,
  sex                VARCHAR,
  evidence_stream    VARCHAR
)`;

// Column spec mirroring MAIN_EVIDENCE_DDL. A CLI-built gene.duckdb
// already has a main.evidence with the *legacy* shape (no role /
// source_id / derivation_id / trait_id), and CREATE TABLE IF NOT
// EXISTS no-ops on it — so we additionally ALTER ADD COLUMN IF NOT
// EXISTS each column. Idempotent, non-destructive (keeps existing
// rows), brings an old table up to the redesign shape.
const EVIDENCE_COLUMNS: Array<[string, string]> = [
  ["source_tag", "VARCHAR"],
  ["evidence_category", "VARCHAR"],
  ["role", "VARCHAR"],
  ["source_id", "UUID"],
  ["derivation_id", "UUID"],
  ["gene_symbol", "VARCHAR"],
  ["chromosome", "VARCHAR"],
  ["position", "BIGINT"],
  ["rsid", "VARCHAR"],
  ["trait", "VARCHAR"],
  ["trait_id", "UUID"],
  ["pvalue", "DOUBLE"],
  ["effect_size", "DOUBLE"],
  ["score", "DOUBLE"],
  ["tissue", "VARCHAR"],
  ["cell_type", "VARCHAR"],
  ["ancestry", "VARCHAR"],
  ["sex", "VARCHAR"],
  ["evidence_stream", "VARCHAR"],
];

async function ensureEvidenceSchema(
  ds: ReturnType<typeof getDataSource>,
): Promise<void> {
  await ds.exec({ sql: MAIN_EVIDENCE_DDL });
  for (const [col, type] of EVIDENCE_COLUMNS) {
    await ds.exec({
      sql: `ALTER TABLE main.evidence ADD COLUMN IF NOT EXISTS ${col} ${type}`,
    });
  }
}

export interface RouteResult {
  derivation_id: string;
  source_tag: string;
  rows: number;
  skipped?: boolean;
  reason?: string;
}

/** Materialize one derivation into main.evidence. The caller (build.ts)
 *  ensures main.raw_<source_id> exists first. */
export async function routeDerivation(
  source: ConfigSource,
  derivation: ConfigDerivation,
): Promise<RouteResult> {
  const ds = getDataSource();
  await ensureEvidenceSchema(ds);

  // Resolve mappings into a flat record { canonical_field → raw_column }.
  // Drop entries whose canonical field isn't a known evidence column.
  const mapping = new Map<string, string>();
  for (const m of derivation.mappings ?? []) {
    if (COLUMN_CASTS[m.canonical_field]) {
      mapping.set(m.canonical_field, m.raw_column);
    }
  }
  const geneCol = mapping.get("gene_symbol");
  if (!geneCol) {
    return {
      derivation_id: derivation.id,
      source_tag: derivation.source_tag,
      rows: 0,
      skipped: true,
      reason: "No gene_symbol mapping — derivation can't emit evidence rows.",
    };
  }

  // Compile transforms over the raw table. With no transforms, this is
  // just `SELECT * FROM main.raw_<source_id>`.
  const transforms = (derivation.transforms ?? []) as DerivationTransform[];
  // compileTransformPipeline expects a TransformConfigEntry-shaped value
  // (`{ type, ...params }`). Spread params here so the compiler sees the
  // same shape the YAML emitted previously.
  const transformEntries = transforms.map((t) => ({
    type: t.type,
    ...(t.params ?? {}),
  }));
  // Pass a full SELECT (not a bare table ref): compileTransformPipeline
  // with sourceIsSql wraps the source in parens, and DuckDB only allows
  // parens around a subquery, not a plain `schema."table"`.
  const transformedSql = compileTransformPipeline(
    transformEntries,
    `SELECT * FROM main.${ident(rawTableName(source.id))}`,
    { sourceIsSql: true },
  );

  // Trait resolution: pre-fetch the trait UUIDs we'll need.
  //   constant scope → fetch label/id pairs for derivation.trait_ids
  //   column scope   → scan distinct values from the trait column, then
  //                    find-or-create config.traits rows for each
  const traitJoin = await buildTraitJoin(derivation, transformedSql, geneCol);

  // Idempotency: clear previous rows for this derivation. Use source_tag
  // since the read paths key on it.
  await ds.exec({
    sql: "DELETE FROM main.evidence WHERE source_tag = ?",
    params: [derivation.source_tag],
  });

  // Build the SELECT clause: constants first, then identity columns,
  // then the mapped canonical fields.
  const targetCols: string[] = [
    "source_tag",
    "evidence_category",
    "role",
    "source_id",
    "derivation_id",
    "trait",
    "trait_id",
  ];
  const selects: string[] = [
    `${strLit(derivation.source_tag)} AS source_tag`,
    `${strLit(derivation.evidence_category)} AS evidence_category`,
    `${strLit(derivation.role)} AS role`,
    `CAST(${strLit(source.id)} AS UUID) AS source_id`,
    `CAST(${strLit(derivation.id)} AS UUID) AS derivation_id`,
    `${traitJoin.traitSelect} AS trait`,
    `${traitJoin.traitIdSelect} AS trait_id`,
  ];
  for (const field of Object.keys(COLUMN_CASTS)) {
    const raw = mapping.get(field);
    if (!raw) continue;
    targetCols.push(field);
    selects.push(`${COLUMN_CASTS[field]!(ident(raw))} AS ${ident(field)}`);
  }

  const where =
    `${ident(geneCol)} IS NOT NULL ` +
    `AND LOWER(CAST(${ident(geneCol)} AS VARCHAR)) <> 'nan' ` +
    `AND CAST(${ident(geneCol)} AS VARCHAR) <> ''`;

  const sql =
    `INSERT INTO main.evidence (${targetCols.map(ident).join(", ")}) ` +
    `SELECT ${selects.join(", ")} ` +
    `FROM (${transformedSql}) AS src ` +
    `${traitJoin.fromClause} ` +
    `WHERE ${where}`;

  await ds.exec({ sql });

  const [count] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.evidence WHERE source_tag = ?",
    params: [derivation.source_tag],
  });

  return {
    derivation_id: derivation.id,
    source_tag: derivation.source_tag,
    rows: Number(count?.n ?? 0),
  };
}

interface TraitJoin {
  fromClause: string;
  traitSelect: string;
  traitIdSelect: string;
}

async function buildTraitJoin(
  derivation: ConfigDerivation,
  transformedSql: string,
  _geneCol: string,
): Promise<TraitJoin> {
  if (derivation.trait_scope === "constant") {
    const traitIds = derivation.trait_ids ?? [];
    if (traitIds.length === 0) {
      // No traits declared — emit one row per source row with trait
      // unset. The user sees these as "untagged" evidence in the UI.
      return {
        fromClause: "",
        traitSelect: "NULL",
        traitIdSelect: "NULL",
      };
    }
    // Pull labels for the trait IDs so each emitted row carries both
    // canonical id and human-readable label.
    const traits = await Promise.all(traitIds.map((id) => getTrait(id)));
    const valuesRows = traits
      .filter((t): t is ConfigTrait => !!t)
      .map(
        (t) =>
          `(CAST(${strLit(t.id)} AS UUID), ${strLit(t.label)})`,
      );
    if (valuesRows.length === 0) {
      return { fromClause: "", traitSelect: "NULL", traitIdSelect: "NULL" };
    }
    return {
      fromClause:
        `CROSS JOIN (VALUES ${valuesRows.join(", ")}) AS _t(trait_id, trait_label)`,
      traitSelect: "_t.trait_label",
      traitIdSelect: "_t.trait_id",
    };
  }

  // column scope: pre-populate config.traits with every distinct value
  // found in the trait column so the LEFT JOIN below can resolve them.
  if (!derivation.trait_column) {
    return { fromClause: "", traitSelect: "NULL", traitIdSelect: "NULL" };
  }
  const traitCol = derivation.trait_column.raw_column;
  await ensureTraitsForColumn(transformedSql, traitCol);
  return {
    fromClause:
      `LEFT JOIN config.traits _t ON _t.label = CAST(src.${ident(traitCol)} AS VARCHAR)`,
    traitSelect: `CAST(src.${ident(traitCol)} AS VARCHAR)`,
    traitIdSelect: "_t.id",
  };
}

/** Scan distinct non-null values in the trait column and find-or-create
 *  config.traits rows for each. Called once before the route INSERT runs. */
async function ensureTraitsForColumn(
  transformedSql: string,
  traitCol: string,
): Promise<void> {
  const ds = getDataSource();
  const rows = await ds.query<{ trait_label: string | null }>({
    sql:
      `SELECT DISTINCT CAST(${ident(traitCol)} AS VARCHAR) AS trait_label ` +
      `FROM (${transformedSql}) AS src ` +
      `WHERE ${ident(traitCol)} IS NOT NULL`,
  });
  for (const row of rows) {
    const label = row.trait_label;
    if (!label || label.toLowerCase() === "nan" || label === "") continue;
    await findOrCreateByLabel(label);
  }
}
