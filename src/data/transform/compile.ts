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

/** Escape regex metacharacters so a literal string matches itself. */
function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape LIKE wildcards (used with `ESCAPE '\'`). */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** A binary math operand: a numeric literal if it parses as a number, else a
 *  column reference cast to DOUBLE. */
function numberOrColumn(v: unknown): string {
  const s = String(v ?? "").trim();
  if (s === "") return "NULL";
  return Number.isFinite(Number(s)) && /[0-9]/.test(s)
    ? String(Number(s))
    : `TRY_CAST(${ident(s)} AS DOUBLE)`;
}

/** A numeric literal, or NULL if the string isn't numeric. */
function numLit(s: string): string {
  const t = s.trim();
  return t !== "" && Number.isFinite(Number(t)) ? String(Number(t)) : "NULL";
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
  const list = cols.map(ident).join(", ");
  // mode: keep (default) projects only these; drop removes them.
  return String(t.mode ?? "keep") === "drop"
    ? `SELECT * EXCLUDE (${list}) FROM ${sub(input)}`
    : `SELECT ${list} FROM ${sub(input)}`;
}

function compileDeduplicate(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return `SELECT DISTINCT * FROM ${sub(input)}`;
  // Use ROW_NUMBER + filter. A monotonic _dedup_rid captures input order so
  // we can keep the first/last occurrence (or the best row by an order_by
  // column, e.g. lowest p-value per gene).
  const partition = cols.map(ident).join(", ");
  const keep = String(t.keep ?? "first") === "last" ? "last" : "first";
  const orderBy = String(t.order_by ?? "").trim();
  const dir = String(t.order_dir ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const ridDir = keep === "last" ? "DESC" : "ASC";
  // ROW_NUMBER = 1 must land on the row we want to keep.
  const order = orderBy
    ? `${ident(orderBy)} ${
        keep === "last" ? (dir === "ASC" ? "DESC" : "ASC") : dir
      } NULLS LAST, _dedup_rid ${ridDir}`
    : `_dedup_rid ${ridDir}`;
  return (
    `SELECT * EXCLUDE (_dedup_rn, _dedup_rid) FROM (` +
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${order}) AS _dedup_rn ` +
    `FROM (SELECT *, ROW_NUMBER() OVER () AS _dedup_rid FROM ${sub(input)})` +
    `) WHERE _dedup_rn = 1`
  );
}

// Add or strip a prefix/suffix on one or more columns. Replaces the old
// strip_prefix + add_prefix. `idempotent` add skips columns that already have
// the affix (so re-running won't produce chrchr1).
function compileAffix(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns ?? t.column);
  const text = String(t.text ?? "");
  if (cols.length === 0 || text === "") return input;
  const action = String(t.action ?? "strip");
  const side = String(t.side ?? "prefix");
  const ci = Boolean(t.case_insensitive);
  const idempotent = t.idempotent !== false; // default true
  const replaces = cols.map((col) => {
    const c = `CAST(${ident(col)} AS VARCHAR)`;
    let expr: string;
    if (action === "add") {
      const added =
        side === "prefix" ? `${strLit(text)} || ${c}` : `${c} || ${strLit(text)}`;
      if (idempotent) {
        const op = ci ? "ILIKE" : "LIKE";
        const pat =
          side === "prefix" ? `${likeEscape(text)}%` : `%${likeEscape(text)}`;
        expr = `CASE WHEN ${c} ${op} ${strLit(pat)} ESCAPE '\\' THEN ${c} ELSE ${added} END`;
      } else {
        expr = added;
      }
    } else {
      const pat = side === "prefix" ? `^${regexEscape(text)}` : `${regexEscape(text)}$`;
      expr = ci
        ? `REGEXP_REPLACE(${c}, ${strLit(pat)}, '', 'i')`
        : `REGEXP_REPLACE(${c}, ${strLit(pat)}, '')`;
    }
    return `${expr} AS ${ident(col)}`;
  });
  return `SELECT * REPLACE (${replaces.join(", ")}) FROM ${sub(input)}`;
}

// Case-normalize and/or trim text columns. Replaces the old uppercase.
function compileFormatText(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns ?? t.column);
  const caseMode = String(t.case ?? "none");
  const trim = Boolean(t.trim);
  if (cols.length === 0 || (caseMode === "none" && !trim)) return input;
  const replaces = cols.map((col) => {
    let e = ident(col);
    if (trim) e = `TRIM(${e})`;
    if (caseMode === "upper") e = `UPPER(${e})`;
    else if (caseMode === "lower") e = `LOWER(${e})`;
    return `${e} AS ${ident(col)}`;
  });
  return `SELECT * REPLACE (${replaces.join(", ")}) FROM ${sub(input)}`;
}

function compileDropNulls(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  // any (default): drop a row if ANY listed col is null → keep where all are
  //   non-null (AND). all: drop only if ALL are null → keep where any non-null (OR).
  const join = String(t.mode ?? "any") === "all" ? " OR " : " AND ";
  const where = cols.map((c) => `${ident(c)} IS NOT NULL`).join(join);
  return `SELECT * FROM ${sub(input)} WHERE ${where}`;
}

function compileCoerceNumeric(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  const type = Boolean(t.integer) ? "BIGINT" : "DOUBLE";
  const replaces = cols
    .map((c) => `TRY_CAST(${ident(c)} AS ${type}) AS ${ident(c)}`)
    .join(", ");
  return `SELECT * REPLACE (${replaces}) FROM ${sub(input)}`;
}

// Keep/drop rows by a condition. Replaces the old filter_values (= operator
// `in`). Numeric comparisons TRY_CAST the column so dirty strings don't abort.
const FILTER_CMP: Record<string, string> = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};
function compileFilter(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  if (!col) return input;
  const op = String(t.operator ?? "in");
  const ci = Boolean(t.case_insensitive);
  const c = ident(col);
  let cond: string;
  if (op === "in" || op === "not_in") {
    const values = (t.values as unknown[] | undefined) ?? [];
    if (values.length === 0) return input;
    cond = `${c} ${op === "not_in" ? "NOT IN" : "IN"} (${values.map(lit).join(", ")})`;
  } else if (op === "between") {
    const lo = String(t.low ?? "");
    const hi = String(t.high ?? "");
    if (lo.trim() === "" || hi.trim() === "") return input;
    cond = `TRY_CAST(${c} AS DOUBLE) BETWEEN ${numLit(lo)} AND ${numLit(hi)}`;
  } else if (op === "contains" || op === "not_contains") {
    const v = String(t.value ?? "");
    if (v === "") return input;
    const likeOp = ci ? "ILIKE" : "LIKE";
    cond = `CAST(${c} AS VARCHAR) ${op === "not_contains" ? "NOT " : ""}${likeOp} ${strLit(
      `%${likeEscape(v)}%`,
    )} ESCAPE '\\'`;
  } else if (FILTER_CMP[op]) {
    const sqlOp = FILTER_CMP[op];
    const v = String(t.value ?? "");
    if (v.trim() === "") return input;
    if (Number.isFinite(Number(v.trim()))) {
      cond = `TRY_CAST(${c} AS DOUBLE) ${sqlOp} ${Number(v.trim())}`;
    } else if (ci && (op === "eq" || op === "ne")) {
      cond = `UPPER(CAST(${c} AS VARCHAR)) ${sqlOp} UPPER(${strLit(v)})`;
    } else {
      cond = `${c} ${sqlOp} ${strLit(v)}`;
    }
  } else {
    return input;
  }
  return `SELECT * FROM ${sub(input)} WHERE ${cond}`;
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
  const cols = [
    `REGEXP_EXTRACT(${ident(col)}, ${pattern}, 1) AS ${ident("chromosome")}`,
    `TRY_CAST(REGEXP_EXTRACT(${ident(col)}, ${pattern}, 2) AS BIGINT) AS ${ident("position")}`,
  ];
  if (Boolean(t.capture_alleles)) {
    // Optional ref/alt after the position, separated by any of : _ / > -.
    const ap = strLit(
      "^(?:chr)?\\w+[:_-]\\d+[:_/>-]?([A-Za-z]+)?[:_/>-]?([A-Za-z]+)?",
    );
    cols.push(
      `NULLIF(REGEXP_EXTRACT(${ident(col)}, ${ap}, 1), '') AS ${ident("ref")}`,
      `NULLIF(REGEXP_EXTRACT(${ident(col)}, ${ap}, 2), '') AS ${ident("alt")}`,
    );
  }
  return `SELECT *, ${cols.join(", ")} FROM ${sub(input)}`;
}

function compileSplitColumn(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const delimiter = String(t.delimiter ?? ",");
  const into = asColumnList(t.columns);
  if (!col || into.length === 0) return input;
  const trim = Boolean(t.trim);
  // DuckDB: string_split returns LIST<VARCHAR>, 1-indexed.
  const parts = into
    .map((out, i) => {
      const piece = `string_split(CAST(${ident(col)} AS VARCHAR), ${strLit(delimiter)})[${i + 1}]`;
      return `${trim ? `TRIM(${piece})` : piece} AS ${ident(out)}`;
    })
    .join(", ");
  return `SELECT *, ${parts} FROM ${sub(input)}`;
}

function compileAggregate(t: TransformConfigEntry, input: string): string {
  const groupBy = asColumnList(t.group_by);
  const agg = (t.agg as Record<string, string> | undefined) ?? {};
  if (groupBy.length === 0 || Object.keys(agg).length === 0) return input;
  const ALLOWED_AGGS = new Set([
    "min", "max", "sum", "avg", "count", "count_distinct", "median",
    "first", "last", "string_agg", "array_agg",
  ]);
  const aggCols = Object.entries(agg)
    .map(([col, fn]) => {
      const f = String(fn).toLowerCase();
      if (!ALLOWED_AGGS.has(f)) {
        throw new Error(`Unsupported aggregate function: ${fn}`);
      }
      const expr =
        f === "count_distinct"
          ? `COUNT(DISTINCT ${ident(col)})`
          : `${f.toUpperCase()}(${ident(col)})`;
      return `${expr} AS ${ident(col)}`;
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
  // adapter — see Phase 1c gene-mapping loader. `_in.* REPLACE` keeps the
  // mapped column in its original position so the table view doesn't shuffle
  // it to the end.
  const stripVersion = `REGEXP_REPLACE(_in.${ident(col)}, '\\.\\d+$', '')`;
  const joined =
    `SELECT _in.* REPLACE (gm.symbol AS ${ident(col)}) ` +
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
  // trailing delimiters don't yield blank rows. `* REPLACE` (vs the
  // older `* EXCLUDE … , … AS col`) keeps the exploded column in its
  // original position so the table view doesn't visually shuffle the
  // column to the end.
  return (
    `SELECT * FROM (` +
    `SELECT * REPLACE (${valueExpr} AS ${ident(col)}) ` +
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

// Combine columns into one with a separator (e.g. chr:pos:ref:alt). CONCAT_WS
// skips nulls. New column; originals untouched.
function compileConcatColumns(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  const output = String(t.output ?? "").trim();
  if (cols.length === 0 || !output) return input;
  const sep = String(t.separator ?? "");
  const args = cols.map((c) => `CAST(${ident(c)} AS VARCHAR)`).join(", ");
  return `SELECT *, CONCAT_WS(${strLit(sep)}, ${args}) AS ${ident(output)} FROM ${sub(input)}`;
}

// Find & replace text in a column. Literal by default; `regex` treats `find`
// as a pattern. Replaces all matches unless `all` is false.
function compileFindReplace(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const find = String(t.find ?? "");
  if (!col || find === "") return input;
  const repl = String(t.replace ?? "");
  const pattern = Boolean(t.regex) ? find : regexEscape(find);
  const opts = `${t.all !== false ? "g" : ""}${t.case_insensitive ? "i" : ""}`;
  const c = `CAST(${ident(col)} AS VARCHAR)`;
  const call = opts
    ? `REGEXP_REPLACE(${c}, ${strLit(pattern)}, ${strLit(repl)}, ${strLit(opts)})`
    : `REGEXP_REPLACE(${c}, ${strLit(pattern)}, ${strLit(repl)})`;
  return `SELECT * REPLACE (${call} AS ${ident(col)}) FROM ${sub(input)}`;
}

// Pull part of a value into a new column. Friendly modes (before/after/between
// a delimiter, first N chars) cover the common cases; `pattern` is the regex
// escape hatch.
function compileExtract(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const into = String(t.into ?? "").trim();
  if (!col || !into) return input;
  const c = `CAST(${ident(col)} AS VARCHAR)`;
  const mode = String(t.mode ?? "before");
  let expr: string;
  if (mode === "before") {
    const d = String(t.delimiter ?? "");
    if (d === "") return input;
    expr = `split_part(${c}, ${strLit(d)}, 1)`;
  } else if (mode === "after") {
    const d = String(t.delimiter ?? "");
    if (d === "") return input;
    expr = `REGEXP_REPLACE(${c}, ${strLit(`^.*?${regexEscape(d)}`)}, '')`;
  } else if (mode === "between") {
    const s = String(t.start_delim ?? "");
    const e = String(t.end_delim ?? "");
    if (s === "" || e === "") return input;
    expr = `REGEXP_EXTRACT(${c}, ${strLit(`${regexEscape(s)}(.*?)${regexEscape(e)}`)}, 1)`;
  } else if (mode === "first_chars") {
    const n = Number(t.n ?? 0);
    if (!Number.isFinite(n) || n <= 0) return input;
    expr = `LEFT(${c}, ${Math.floor(n)})`;
  } else if (mode === "pattern") {
    const p = String(t.pattern ?? "");
    if (p === "") return input;
    const g = Number(t.group ?? 1);
    expr = `REGEXP_EXTRACT(${c}, ${strLit(p)}, ${Number.isFinite(g) ? Math.floor(g) : 1})`;
  } else {
    return input;
  }
  return `SELECT *, ${expr} AS ${ident(into)} FROM ${sub(input)}`;
}

// Per-row math on a numeric column. Unary (−log10, log10, ln, …) or binary
// (+ − × ÷ ^) against a number or another column. Writes a new column when
// `into` is set, else replaces in place.
const MATH_UNARY: Record<string, (c: string) => string> = {
  neg_log10: (c) => `-log10(${c})`,
  log10: (c) => `log10(${c})`,
  ln: (c) => `ln(${c})`,
  log2: (c) => `log2(${c})`,
  exp: (c) => `exp(${c})`,
  sqrt: (c) => `sqrt(${c})`,
  abs: (c) => `abs(${c})`,
  negate: (c) => `-(${c})`,
  floor: (c) => `floor(${c})`,
  ceil: (c) => `ceil(${c})`,
};
const MATH_BINARY: Record<string, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  power: "^", // handled specially below
};
function compileMath(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  if (!col) return input;
  const op = String(t.op ?? "");
  const c = `TRY_CAST(${ident(col)} AS DOUBLE)`;
  let expr: string;
  if (op === "round") {
    const d = Number(t.decimals ?? 0);
    expr = `round(${c}, ${Number.isFinite(d) ? Math.floor(d) : 0})`;
  } else if (MATH_UNARY[op]) {
    expr = MATH_UNARY[op]!(c);
  } else if (op === "divide") {
    expr = `${c} / NULLIF(${numberOrColumn(t.operand)}, 0)`;
  } else if (op === "power") {
    expr = `pow(${c}, ${numberOrColumn(t.operand)})`;
  } else if (MATH_BINARY[op]) {
    expr = `${c} ${MATH_BINARY[op]} ${numberOrColumn(t.operand)}`;
  } else {
    return input;
  }
  const into = String(t.into ?? "").trim();
  return into
    ? `SELECT *, ${expr} AS ${ident(into)} FROM ${sub(input)}`
    : `SELECT * REPLACE (${expr} AS ${ident(col)}) FROM ${sub(input)}`;
}

// Turn sentinel values (NA, N/A, ., empty, whitespace, …) into real NULL so
// drop_nulls / numeric casts behave. Generalizes the hardcoded loci.ts set.
function compileNormalizeNulls(t: TransformConfigEntry, input: string): string {
  const cols = asColumnList(t.columns);
  if (cols.length === 0) return input;
  const empty = t.empty !== false; // default true
  const whitespace = t.whitespace !== false; // default true
  const ci = t.case_insensitive !== false; // default true
  const sentinels =
    Array.isArray(t.sentinels) && t.sentinels.length > 0
      ? (t.sentinels as unknown[]).map(String)
      : ["NA", "N/A", "NaN", "None", "NULL", "."];
  const replaces = cols.map((col) => {
    const c = `CAST(${ident(col)} AS VARCHAR)`;
    const conds: string[] = [];
    if (whitespace) conds.push(`TRIM(${c}) = ''`);
    else if (empty) conds.push(`${c} = ''`);
    if (sentinels.length > 0) {
      const lhs = ci ? `UPPER(TRIM(${c}))` : `TRIM(${c})`;
      const list = sentinels
        .map((s) => strLit(ci ? s.toUpperCase() : s))
        .join(", ");
      conds.push(`${lhs} IN (${list})`);
    }
    if (conds.length === 0) return `${ident(col)} AS ${ident(col)}`;
    return `CASE WHEN ${conds.join(" OR ")} THEN NULL ELSE ${ident(col)} END AS ${ident(col)}`;
  });
  return `SELECT * REPLACE (${replaces.join(", ")}) FROM ${sub(input)}`;
}

// Remap specific values in a column (e.g. {"M":"male"}). Unmapped values pass
// through unchanged.
function compileReplaceValues(t: TransformConfigEntry, input: string): string {
  const col = String(t.column ?? "");
  const map = asColumnMap(t.mapping);
  const entries = Object.entries(map);
  if (!col || entries.length === 0) return input;
  const ci = Boolean(t.case_insensitive);
  const lhs = ci
    ? `UPPER(CAST(${ident(col)} AS VARCHAR))`
    : `CAST(${ident(col)} AS VARCHAR)`;
  const whens = entries
    .map(
      ([from, to]) =>
        `WHEN ${lhs} = ${strLit(ci ? from.toUpperCase() : from)} THEN ${strLit(to)}`,
    )
    .join(" ");
  return `SELECT * REPLACE (CASE ${whens} ELSE ${ident(col)} END AS ${ident(col)}) FROM ${sub(input)}`;
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
    case "concat_columns":
      return compileConcatColumns(t, input);
    case "deduplicate":
      return compileDeduplicate(t, input);
    case "affix":
      return compileAffix(t, input);
    case "format_text":
      return compileFormatText(t, input);
    case "find_replace":
      return compileFindReplace(t, input);
    case "extract":
      return compileExtract(t, input);
    case "drop_nulls":
      return compileDropNulls(t, input);
    case "normalize_nulls":
      return compileNormalizeNulls(t, input);
    case "replace_values":
      return compileReplaceValues(t, input);
    case "coerce_numeric":
      return compileCoerceNumeric(t, input);
    case "filter":
      return compileFilter(t, input);
    case "math":
      return compileMath(t, input);
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
