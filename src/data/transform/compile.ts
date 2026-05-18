// Transform DSL → DuckDB SQL compiler.
//
// Each `compileX` takes a transform spec + a SQL expression representing the
// upstream rows, and returns a SQL expression that wraps the upstream with
// the transform applied. Pipelines compose via plain SQL nesting.
//
// SQL targets DuckDB. Notes on Postgres divergence are inline; a per-backend
// dialect emit is a small follow-up if/when the Postgres adapter lands.

import type { TransformConfigEntry } from "../../api/types";

// --- Helpers ------------------------------------------------------------

/** Double-quote an identifier; escape inner double-quotes. */
function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Single-quote a string literal; escape inner single-quotes. */
function strLit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Quote any scalar SQL literal. */
function lit(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return strLit(String(value));
}

/** Wrap input SQL as a subquery so it can be SELECTed from. */
function sub(input: string): string {
  return `(${input})`;
}

/** Coerce the heterogeneous `columns` field into a list. */
function asColumnList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  return [];
}

/** Coerce the heterogeneous `columns` field into an old→new mapping. */
function asColumnMap(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, string>;
  }
  return {};
}

// --- Per-transform compilers --------------------------------------------

function compileRename(t: TransformConfigEntry, input: string): string {
  const cols = asColumnMap(t.columns);
  const entries = Object.entries(cols);
  if (entries.length === 0) return input;
  const pairs = entries
    .map(([from, to]) => `${ident(from)} AS ${ident(to)}`)
    .join(", ");
  // DuckDB-specific: SELECT * RENAME (...) keeps all other columns.
  // Postgres equivalent: explicit column list.
  return `SELECT * RENAME (${pairs}) FROM ${sub(input)}`;
}

function compileSelect(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  return `SELECT ${cols.map(ident).join(", ")} FROM ${sub(input)}`;
}

function compileDeduplicate(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return `SELECT DISTINCT * FROM ${sub(input)}`;
  // Use ROW_NUMBER + filter — works on both DuckDB and Postgres without
  // requiring DISTINCT ON's strict ORDER BY semantics.
  const partition = cols.map(ident).join(", ");
  // Deterministic "keep first by input order": capture a monotonic
  // row id over the raw scan, then pick rn=1 ordered by it. Without an
  // ORDER BY, ROW_NUMBER() picks an engine-arbitrary row per group
  // (differs from the legacy first-occurrence semantics).
  return (
    `SELECT * EXCLUDE (_dedup_rn, _dedup_rid) FROM (` +
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY _dedup_rid) AS _dedup_rn ` +
    `FROM (SELECT *, ROW_NUMBER() OVER () AS _dedup_rid FROM ${sub(input)})` +
    `) WHERE _dedup_rn = 1`
  );
}

function compileStripPrefix(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const prefix = String(t.prefix ?? "");
  if (!col || !prefix) return input;
  // REGEXP_REPLACE with anchored pattern. Escape regex metacharacters.
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    `SELECT * REPLACE (` +
    `REGEXP_REPLACE(${ident(col)}, ${strLit(`^${escaped}`)}, '') AS ${ident(col)}` +
    `) FROM ${sub(input)}`
  );
}

function compileUppercase(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  if (!col) return input;
  return `SELECT * REPLACE (UPPER(${ident(col)}) AS ${ident(col)}) FROM ${sub(input)}`;
}

function compileDropNulls(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  const where = cols.map((c) => `${ident(c)} IS NOT NULL`).join(" AND ");
  return `SELECT * FROM ${sub(input)} WHERE ${where}`;
}

function compileCoerceNumeric(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  const replaces = cols
    .map((c) => `TRY_CAST(${ident(c)} AS DOUBLE) AS ${ident(c)}`)
    .join(", ");
  return `SELECT * REPLACE (${replaces}) FROM ${sub(input)}`;
}

function compileFilterValues(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const values = (t.values as unknown[] | undefined) ?? [];
  if (!col || values.length === 0) return input;
  const list = values.map(lit).join(", ");
  return `SELECT * FROM ${sub(input)} WHERE ${ident(col)} IN (${list})`;
}

function compileParseVariantId(
  t: TransformConfigEntry,
  input: string,
): string {
  const col = String(t.column ?? "");
  if (!col) return input;
  // Handles: chr1:16979534C:A | 3:44861942 | X-100_A | 10:103897116:G:A
  // Optional whole "chr" prefix (non-capturing), then chromosome token,
  // then a :/-/_ separator, then position. Mirrors the legacy regex
  // /^(?:chr)?(\w+)[:\-_](\d+)/. The previous pattern `chr?(\d+|X|Y):`
  // meant "ch" + optional "r" (so bare "3:..." never matched) and only
  // accepted digit/X/Y chromosomes and a ':' separator — a real bug.
  const pattern = strLit("^(?:chr)?(\\w+)[:_-](\\d+)");
  return (
    `SELECT *, ` +
    `REGEXP_EXTRACT(${ident(col)}, ${pattern}, 1) AS ${ident("chromosome")}, ` +
    `TRY_CAST(REGEXP_EXTRACT(${ident(col)}, ${pattern}, 2) AS BIGINT) AS ${ident("position")} ` +
    `FROM ${sub(input)}`
  );
}

function compileSplitColumn(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const delimiter = String(t.delimiter ?? ",");
  const into = asColumnList(t.columns);
  if (!col || into.length === 0) return input;
  // DuckDB: string_split returns LIST<VARCHAR>, 1-indexed.
  const parts = into
    .map(
      (out, i) =>
        `string_split(${ident(col)}, ${strLit(delimiter)})[${i + 1}] AS ${ident(out)}`,
    )
    .join(", ");
  return `SELECT *, ${parts} FROM ${sub(input)}`;
}

function compileAggregate(t: TransformConfigEntry, input: string): string {
  const groupBy = asColumnList(t.group_by);
  const agg = (t.agg as Record<string, string> | undefined) ?? {};
  if (groupBy.length === 0 || Object.keys(agg).length === 0) return input;
  const ALLOWED_AGGS = new Set(["min", "max", "sum", "avg", "count", "first", "last", "string_agg", "array_agg"]);
  const aggCols = Object.entries(agg)
    .map(([col, fn]) => {
      const f = String(fn).toLowerCase();
      if (!ALLOWED_AGGS.has(f)) {
        throw new Error(`Unsupported aggregate function: ${fn}`);
      }
      return `${f.toUpperCase()}(${ident(col)}) AS ${ident(col)}`;
    })
    .join(", ");
  const groupCols = groupBy.map(ident).join(", ");
  return (
    `SELECT ${groupCols}, ${aggCols} FROM ${sub(input)} GROUP BY ${groupCols}`
  );
}

function compileCompute(t: TransformConfigEntry, input: string): string {
  const output = String(t.output ?? "");
  const expression = String(t.expression ?? "");
  if (!output || !expression) return input;
  // The expression is user-authored and runs as raw SQL. The Python pandas
  // implementation does the same via DataFrame.eval(). Restrict callers in
  // the schema-driven UI; this is otherwise an injection vector.
  return `SELECT *, (${expression}) AS ${ident(output)} FROM ${sub(input)}`;
}

function compileMapGeneId(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const from = String(t.from ?? "");
  const to = String(t.to ?? "");
  const dropUnmapped = Boolean(t.drop_unmapped);
  if (!col || from !== "ensembl" || to !== "hgnc") return input;
  // Strip Ensembl version suffix (ENSG00000227232.5 → ENSG00000227232) before
  // joining. gene_mapping is loaded by createGeneMappingTable() in the
  // adapter — see Phase 1c gene-mapping loader.
  const stripVersion = `REGEXP_REPLACE(_in.${ident(col)}, '\\.\\d+$', '')`;
  const joined =
    `SELECT _in.* EXCLUDE (${ident(col)}), gm.symbol AS ${ident(col)} ` +
    `FROM ${sub(input)} _in ` +
    `LEFT JOIN main.gene_mapping gm ON gm.ensembl_gene_id = ${stripVersion}`;
  return dropUnmapped
    ? `SELECT * FROM (${joined}) WHERE ${ident(col)} IS NOT NULL`
    : joined;
}

// --- Custom transforms (named functions) --------------------------------

function compileCustomParseEvidence(input: string): string {
  // Input has an `evidence` column with strings like "GENE1(trait1), GENE2(trait2)".
  // Output: original columns minus `evidence`, plus `gene` and `term`.
  return (
    `WITH _split AS (` +
    `SELECT *, UNNEST(string_split(evidence, ', ')) AS _pair ` +
    `FROM ${sub(input)}` +
    `) ` +
    `SELECT * EXCLUDE (evidence, _pair), ` +
    `TRIM(REGEXP_EXTRACT(_pair, '^([^(]*)', 1)) AS gene, ` +
    `TRIM(REGEXP_EXTRACT(_pair, '\\(([^)]+)\\)', 1)) AS term ` +
    `FROM _split`
  );
}

function compileCustomApplyFTrait(input: string): string {
  // For each gene, keep the row with the lowest minP (best GWAS hit) and
  // collect all unique traits the gene appears in across the input.
  // Aggregates trait + other_traits if present; falls back gracefully if not.
  return (
    `WITH _ranked AS (` +
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY gene ORDER BY minP NULLS LAST) AS _rn ` +
    `FROM ${sub(input)}` +
    `), _all_traits AS (` +
    `SELECT gene, ARRAY_AGG(DISTINCT trait) AS _all_traits FROM ${sub(input)} ` +
    `GROUP BY gene` +
    `) ` +
    `SELECT _r.* EXCLUDE (_rn), _t._all_traits ` +
    `FROM _ranked _r LEFT JOIN _all_traits _t ON _t.gene = _r.gene ` +
    `WHERE _r._rn = 1`
  );
}

/** Explode a delimiter-separated column into multiple rows.
 *
 *   {type: 'explode_column', column: 'trait', delimiter: ','}
 *   → row with trait="FEV1,FVC" becomes two rows, trait="FEV1" and trait="FVC".
 *
 * Uses DuckDB's UNNEST + string_split. Whitespace trimmed from each
 * value when `trim` is true (default). Empty strings post-split are
 * filtered out so trailing delimiters don't produce phantom rows.
 *
 * Cardinality-changing transform — most others preserve row count, but
 * this one is N→M. Useful for aggregated gene-list files that pack
 * multiple traits / tissues / contexts per row. */
function compileExplodeColumn(t: TransformConfigEntry, input: string): string {
  const col = String((t as { column?: string }).column ?? "").trim();
  if (!col) return input;
  const delim = String((t as { delimiter?: string }).delimiter ?? ",");
  const trim = (t as { trim?: boolean }).trim !== false;
  const valueExpr = trim
    ? `TRIM(UNNEST(string_split(CAST(${ident(col)} AS VARCHAR), ${strLit(delim)})))`
    : `UNNEST(string_split(CAST(${ident(col)} AS VARCHAR), ${strLit(delim)}))`;
  // Two-stage: UNNEST in an inner SELECT (filtering NULL originals
  // pre-explode), then strip empty results in an outer SELECT so
  // trailing delimiters don't yield blank rows.
  return (
    `SELECT * FROM (` +
    `SELECT * EXCLUDE (${ident(col)}), ${valueExpr} AS ${ident(col)} ` +
    `FROM ${sub(input)} ` +
    `WHERE ${ident(col)} IS NOT NULL` +
    `) ` +
    `WHERE ${ident(col)} <> ''`
  );
}

function compileCustom(t: TransformConfigEntry, input: string): string {
  const fn = String((t as { custom_function?: string }).custom_function ?? "");
  switch (fn) {
    case "parse_evidence":
      return compileCustomParseEvidence(input);
    case "apply_f_trait":
      return compileCustomApplyFTrait(input);
    default:
      throw new Error(`Unknown custom function: ${fn}`);
  }
}

// --- Public API ---------------------------------------------------------

export function compileTransform(
  t: TransformConfigEntry,
  input: string,
): string {
  switch (t.type) {
    case "rename":
      return compileRename(t, input);
    case "select":
      return compileSelect(t, input);
    case "deduplicate":
      return compileDeduplicate(t, input);
    case "strip_prefix":
      return compileStripPrefix(t, input);
    case "uppercase":
      return compileUppercase(t, input);
    case "drop_nulls":
      return compileDropNulls(t, input);
    case "coerce_numeric":
      return compileCoerceNumeric(t, input);
    case "filter_values":
      return compileFilterValues(t, input);
    case "parse_variant_id":
      return compileParseVariantId(t, input);
    case "split_column":
      return compileSplitColumn(t, input);
    case "explode_column":
      return compileExplodeColumn(t, input);
    case "aggregate":
      return compileAggregate(t, input);
    case "compute":
      return compileCompute(t, input);
    case "map_gene_id":
      return compileMapGeneId(t, input);
    case "custom":
      return compileCustom(t, input);
    default:
      throw new Error(`Unknown transform type: ${t.type}`);
  }
}

/**
 * Compile a sequence of transforms over a source table or expression.
 *
 * @param transforms ordered list of transform specs
 * @param source either a bare table identifier (will be quoted) or a
 *   pre-constructed SQL expression — when passing an expression, set
 *   `sourceIsSql: true` so we don't double-quote it.
 */
export function compileTransformPipeline(
  transforms: readonly TransformConfigEntry[],
  source: string,
  opts: { sourceIsSql?: boolean } = {},
): string {
  let sql = opts.sourceIsSql
    ? `SELECT * FROM ${sub(source)}`
    : `SELECT * FROM ${ident(source)}`;
  for (const t of transforms) {
    sql = compileTransform(t, sql);
  }
  return sql;
}
