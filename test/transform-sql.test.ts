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

maybe("strip_prefix: removes a literal prefix only at the start", () => {
  expectRows(
    [{ id: "chr1" }, { id: "1" }, { id: "chrX" }],
    { type: "strip_prefix", column: "id", prefix: "chr" } as TransformConfigEntry,
    [{ id: "1" }, { id: "1" }, { id: "X" }],
  );
});

maybe("uppercase: NULL stays NULL", () => {
  expectRows(
    [{ s: "abc" }, { s: null }],
    { type: "uppercase", column: "s" } as TransformConfigEntry,
    [{ s: "ABC" }, { s: null }],
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

maybe("filter_values: keeps rows whose column is in the value list", () => {
  expectRows(
    [{ c: "GWAS" }, { c: "QTL" }, { c: "GWAS" }],
    { type: "filter_values", column: "c", values: ["GWAS"] } as TransformConfigEntry,
    [{ c: "GWAS" }, { c: "GWAS" }],
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
