// DuckDB transform-compiler correctness tests.
//
// These assert the *intended* behaviour of src/data/transform/compile.ts
// by executing the compiled SQL through the DuckDB CLI against a small
// JSON input and diffing the rows. They double as a living spec for the
// transform DSL (and replace the one-off arquero-equivalence harness —
// arquero is being removed; these stand on their own).
//
// Run: `npm test` (or `node --test test/`). Requires the `duckdb` CLI
// on PATH or via the DUCKDB_BIN env var; the suite skips cleanly if it
// isn't found so the build doesn't hard-fail in CLI-less environments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileTransform } from "../src/data/transform/compile.ts";
import type { TransformConfigEntry } from "../src/api/types.ts";

function findDuckdb(): string | null {
  if (process.env.DUCKDB_BIN) return process.env.DUCKDB_BIN;
  for (const p of [
    "/opt/homebrew/bin/duckdb",
    "/usr/local/bin/duckdb",
    "/usr/bin/duckdb",
  ]) {
    try {
      execFileSync(p, ["--version"], { stdio: "ignore" });
      return p;
    } catch {
      /* try next */
    }
  }
  try {
    return execFileSync("which", ["duckdb"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const DUCKDB = findDuckdb();
const dir = mkdtempSync(join(tmpdir(), "tsql-"));

function run(
  rows: unknown[],
  cfg: TransformConfigEntry,
  post?: (s: string) => string,
): unknown[] {
  const inFile = join(dir, "in.json");
  writeFileSync(inFile, JSON.stringify(rows));
  let sql = compileTransform(cfg, `SELECT * FROM read_json_auto('${inFile}')`);
  if (post) sql = post(sql);
  const out = execFileSync(DUCKDB!, ["-json", "-c", sql], {
    encoding: "utf8",
  }).trim();
  return out ? (JSON.parse(out) as unknown[]) : [];
}

function norm(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number")
    return Number.isInteger(v) ? v : +v.toFixed(6);
  if (Array.isArray(v)) return v.map(norm);
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isInteger(n) ? n : +n.toFixed(6);
  }
  return s;
}
function canon(rows: unknown[]): string {
  return JSON.stringify(
    rows
      .map((o) =>
        JSON.stringify(
          Object.keys(o as object)
            .sort()
            .map((k) => [k, norm((o as Record<string, unknown>)[k])]),
        ),
      )
      .sort(),
  );
}
function expectRows(
  rows: unknown[],
  cfg: TransformConfigEntry,
  expected: unknown[],
  post?: (s: string) => string,
) {
  assert.equal(canon(run(rows, cfg, post)), canon(expected));
}

const maybe = DUCKDB ? test : test.skip;
if (!DUCKDB)
  console.warn("[transform-sql] duckdb CLI not found — suite skipped");

maybe("rename: maps listed columns, keeps the rest", () => {
  expectRows(
    [{ a: 1, b: "x" }],
    { type: "rename", columns: { a: "alpha" } } as TransformConfigEntry,
    [{ alpha: 1, b: "x" }],
  );
});

maybe("select: keeps only listed columns", () => {
  expectRows(
    [{ a: 1, b: "x", c: 9 }],
    { type: "select", columns: ["a", "c"] } as TransformConfigEntry,
    [{ a: 1, c: 9 }],
  );
});

maybe("deduplicate: keeps the FIRST row per key (input order)", () => {
  // Regression guard for the ORDER BY fix — first occurrence wins.
  expectRows(
    [
      { g: "A", v: 1 },
      { g: "A", v: 2 },
      { g: "B", v: 3 },
    ],
    { type: "deduplicate", columns: ["g"] } as TransformConfigEntry,
    [
      { g: "A", v: 1 },
      { g: "B", v: 3 },
    ],
  );
});

maybe("affix: strips a literal prefix only at the start", () => {
  expectRows(
    [{ id: "chr1" }, { id: "1" }, { id: "chrX" }],
    {
      type: "affix",
      columns: ["id"],
      action: "strip",
      side: "prefix",
      text: "chr",
    } as TransformConfigEntry,
    [{ id: "1" }, { id: "1" }, { id: "X" }],
  );
});

maybe("affix: add prefix is idempotent (no chrchr1)", () => {
  expectRows(
    [{ id: "1" }, { id: "chr2" }],
    {
      type: "affix",
      columns: ["id"],
      action: "add",
      side: "prefix",
      text: "chr",
      idempotent: true,
    } as TransformConfigEntry,
    [{ id: "chr1" }, { id: "chr2" }],
  );
});

maybe("format_text: uppercase, NULL stays NULL", () => {
  expectRows(
    [{ s: "abc" }, { s: null }],
    { type: "format_text", columns: ["s"], case: "upper" } as TransformConfigEntry,
    [{ s: "ABC" }, { s: null }],
  );
});

maybe("format_text: trim + lowercase", () => {
  expectRows(
    [{ s: "  AbC  " }],
    {
      type: "format_text",
      columns: ["s"],
      case: "lower",
      trim: true,
    } as TransformConfigEntry,
    [{ s: "abc" }],
  );
});

maybe("drop_nulls: filters NULL only (whitespace kept — by design)", () => {
  expectRows(
    [{ x: "a" }, { x: null }, { x: "  " }],
    { type: "drop_nulls", columns: ["x"] } as TransformConfigEntry,
    [{ x: "a" }, { x: "  " }],
  );
});

maybe("coerce_numeric: empty string → NULL (not 0)", () => {
  expectRows(
    [{ n: "1.5" }, { n: "x" }, { n: "" }, { n: "10" }],
    { type: "coerce_numeric", columns: ["n"] } as TransformConfigEntry,
    [{ n: 1.5 }, { n: null }, { n: null }, { n: 10 }],
  );
});

maybe("filter: 'in' keeps rows whose column is in the value list", () => {
  expectRows(
    [{ c: "GWAS" }, { c: "QTL" }, { c: "GWAS" }],
    { type: "filter", column: "c", operator: "in", values: ["GWAS"] } as TransformConfigEntry,
    [{ c: "GWAS" }, { c: "GWAS" }],
  );
});

maybe("filter: numeric '<' threshold (dirty values drop out)", () => {
  expectRows(
    [{ p: "0.1" }, { p: "0.001" }, { p: "x" }],
    { type: "filter", column: "p", operator: "lt", value: "0.05" } as TransformConfigEntry,
    [{ p: "0.001" }],
  );
});

maybe("filter: between (numeric)", () => {
  expectRows(
    [{ n: "5" }, { n: "15" }, { n: "25" }],
    {
      type: "filter",
      column: "n",
      operator: "between",
      low: "10",
      high: "20",
    } as TransformConfigEntry,
    [{ n: "15" }],
  );
});

maybe("filter: contains (case-insensitive)", () => {
  expectRows(
    [{ s: "Lung disease" }, { s: "asthma" }],
    {
      type: "filter",
      column: "s",
      operator: "contains",
      value: "LUNG",
      case_insensitive: true,
    } as TransformConfigEntry,
    [{ s: "Lung disease" }],
  );
});

maybe(
  "parse_variant_id: handles chr-prefixed, bare, and -/_ separators",
  () => {
    // Regression guard for the regex fix.
    expectRows(
      [
        { v: "chr1:16979534C:A" },
        { v: "3:44861942" },
        { v: "X-100_A" },
        { v: "10_222_G_A" },
      ],
      { type: "parse_variant_id", column: "v" } as TransformConfigEntry,
      [
        { v: "chr1:16979534C:A", chromosome: "1", position: 16979534 },
        { v: "3:44861942", chromosome: "3", position: 44861942 },
        { v: "X-100_A", chromosome: "X", position: 100 },
        { v: "10_222_G_A", chromosome: "10", position: 222 },
      ],
    );
  },
);

maybe("split_column: splits into positional named columns", () => {
  expectRows(
    [{ p: "a_b_c" }, { p: "x_y" }],
    {
      type: "split_column",
      column: "p",
      delimiter: "_",
      columns: ["s1", "s2", "s3"],
    } as TransformConfigEntry,
    [
      { p: "a_b_c", s1: "a", s2: "b", s3: "c" },
      { p: "x_y", s1: "x", s2: "y", s3: null },
    ],
  );
});

maybe("explode_column: one row per delimiter-separated value, trimmed", () => {
  expectRows(
    [{ g: "G1", trait: "FEV1, FVC ,PEF" }, { g: "G2", trait: "COPD" }],
    { type: "explode_column", column: "trait", delimiter: "," } as TransformConfigEntry,
    [
      { g: "G1", trait: "FEV1" },
      { g: "G1", trait: "FVC" },
      { g: "G1", trait: "PEF" },
      { g: "G2", trait: "COPD" },
    ],
  );
});

maybe("aggregate: group_by + sum", () => {
  expectRows(
    [
      { g: "A", v: 2 },
      { g: "A", v: 4 },
      { g: "B", v: 9 },
    ],
    { type: "aggregate", group_by: ["g"], agg: { v: "sum" } } as TransformConfigEntry,
    [
      { g: "A", v: 6 },
      { g: "B", v: 9 },
    ],
  );
});

maybe("compute: SQL arithmetic expression → new column", () => {
  expectRows(
    [{ a: 2, b: 3 }],
    { type: "compute", output: "tot", expression: "a + b * 2" } as TransformConfigEntry,
    [{ a: 2, b: 3, tot: 8 }],
  );
});

maybe("map_gene_id: unmapped → NULL (kept unless drop_unmapped)", () => {
  const post = (s: string) =>
    s.replace(
      /main\.gene_mapping/g,
      "(SELECT * FROM (VALUES ('ENSG1','GENEA'),('ENSG2','GENEB')) AS _gm(ensembl_gene_id, symbol))",
    );
  expectRows(
    [{ g: "ENSG1.5" }, { g: "ENSG2" }, { g: "ENSGX" }],
    { type: "map_gene_id", column: "g", from: "ensembl", to: "hgnc" } as TransformConfigEntry,
    [{ g: "GENEA" }, { g: "GENEB" }, { g: null }],
    post,
  );
});

// --- overhaul additions ---

maybe("select: drop mode removes listed columns", () => {
  expectRows(
    [{ a: 1, b: 2, c: 3 }],
    { type: "select", mode: "drop", columns: ["b"] } as TransformConfigEntry,
    [{ a: 1, c: 3 }],
  );
});

maybe("concat_columns: joins with a separator", () => {
  expectRows(
    [{ chr: "1", pos: 100 }],
    {
      type: "concat_columns",
      columns: ["chr", "pos"],
      separator: ":",
      output: "id",
    } as TransformConfigEntry,
    [{ chr: "1", pos: 100, id: "1:100" }],
  );
});

maybe("find_replace: literal replace-all (dots escaped)", () => {
  expectRows(
    [{ s: "a.b.c" }],
    { type: "find_replace", column: "s", find: ".", replace: "-" } as TransformConfigEntry,
    [{ s: "a-b-c" }],
  );
});

maybe("find_replace: regex mode", () => {
  expectRows(
    [{ s: "abc123" }],
    {
      type: "find_replace",
      column: "s",
      find: "[0-9]+",
      replace: "#",
      regex: true,
    } as TransformConfigEntry,
    [{ s: "abc#" }],
  );
});

maybe("extract: before a delimiter → new column", () => {
  expectRows(
    [{ v: "GENE(trait)" }],
    {
      type: "extract",
      column: "v",
      into: "gene",
      mode: "before",
      delimiter: "(",
    } as TransformConfigEntry,
    [{ v: "GENE(trait)", gene: "GENE" }],
  );
});

maybe("extract: between two delimiters", () => {
  expectRows(
    [{ v: "GENE(trait)" }],
    {
      type: "extract",
      column: "v",
      into: "term",
      mode: "between",
      start_delim: "(",
      end_delim: ")",
    } as TransformConfigEntry,
    [{ v: "GENE(trait)", term: "trait" }],
  );
});

maybe("math: -log10 into a new column", () => {
  expectRows(
    [{ p: "0.001" }],
    { type: "math", column: "p", op: "neg_log10", into: "score" } as TransformConfigEntry,
    [{ p: "0.001", score: 3 }],
  );
});

maybe("math: -log10 of 0/negative → NULL, not an error", () => {
  // Underflowed p-values (0) must not abort the build.
  expectRows(
    [{ p: "0.001" }, { p: "0" }, { p: "-1" }],
    { type: "math", column: "p", op: "neg_log10", into: "score" } as TransformConfigEntry,
    [
      { p: "0.001", score: 3 },
      { p: "0", score: null },
      { p: "-1", score: null },
    ],
  );
});

maybe("math: clip clamps to [min, max]", () => {
  // Below-min floored up, above stays — the lossless way to handle p=0 before
  // -log10 (floor to a tiny epsilon).
  expectRows(
    [{ p: "0.001" }, { p: "0.2" }],
    { type: "math", column: "p", op: "clip", min: "0.05" } as TransformConfigEntry,
    [{ p: 0.05 }, { p: 0.2 }],
  );
});

maybe("math: multiply by a constant in place", () => {
  expectRows(
    [{ x: "2" }, { x: "3" }],
    { type: "math", column: "x", op: "multiply", operand: "10" } as TransformConfigEntry,
    [{ x: 20 }, { x: 30 }],
  );
});

maybe("normalize_nulls: sentinels + whitespace → null", () => {
  expectRows(
    [{ x: "NA" }, { x: "." }, { x: "  " }, { x: "real" }, { x: "n/a" }],
    { type: "normalize_nulls", columns: ["x"] } as TransformConfigEntry,
    [{ x: null }, { x: null }, { x: null }, { x: "real" }, { x: null }],
  );
});

maybe("replace_values: maps listed values, passes others", () => {
  expectRows(
    [{ sex: "M" }, { sex: "F" }, { sex: "U" }],
    {
      type: "replace_values",
      column: "sex",
      mapping: { M: "male", F: "female" },
    } as TransformConfigEntry,
    [{ sex: "male" }, { sex: "female" }, { sex: "U" }],
  );
});

maybe("coerce_numeric: integer mode → BIGINT, bad → null", () => {
  expectRows(
    [{ n: "10" }, { n: "x" }],
    { type: "coerce_numeric", columns: ["n"], integer: true } as TransformConfigEntry,
    [{ n: 10 }, { n: null }],
  );
});

maybe("split_column: trims parts when enabled", () => {
  expectRows(
    [{ p: "a , b" }],
    {
      type: "split_column",
      column: "p",
      delimiter: ",",
      columns: ["s1", "s2"],
      trim: true,
    } as TransformConfigEntry,
    [{ p: "a , b", s1: "a", s2: "b" }],
  );
});

maybe("deduplicate: keep lowest order_by per key", () => {
  expectRows(
    [
      { g: "A", p: 0.5 },
      { g: "A", p: 0.1 },
      { g: "B", p: 0.9 },
    ],
    {
      type: "deduplicate",
      columns: ["g"],
      order_by: "p",
      order_dir: "asc",
      keep: "first",
    } as TransformConfigEntry,
    [
      { g: "A", p: 0.1 },
      { g: "B", p: 0.9 },
    ],
  );
});

maybe("parse_variant_id: captures ref/alt when enabled", () => {
  expectRows(
    [{ v: "chr1:100:A:T" }],
    { type: "parse_variant_id", column: "v", capture_alleles: true } as TransformConfigEntry,
    [{ v: "chr1:100:A:T", chromosome: "1", position: 100, ref: "A", alt: "T" }],
  );
});
