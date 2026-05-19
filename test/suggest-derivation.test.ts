// Unit tests for the pure suggest-a-derivation heuristic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestDerivation } from "../src/data/suggestDerivation.ts";

test("maps a typical GWAS variant table", () => {
  const s = suggestDerivation([
    "GENE",
    "CHR",
    "BP",
    "rsID",
    "P",
    "BETA",
    "trait",
  ]);
  assert.equal(s.mappings.gene_symbol, "GENE");
  assert.equal(s.mappings.chromosome, "CHR");
  assert.equal(s.mappings.position, "BP");
  assert.equal(s.mappings.rsid, "rsID");
  assert.equal(s.mappings.pvalue, "P");
  assert.equal(s.mappings.effect_size, "BETA");
  assert.equal(s.centric, "variant");
  assert.equal(s.trait_scope, "column");
  assert.equal(s.trait_column, "trait");
});

test("gene-level table (no coords) → gene-centric, constant scope", () => {
  const s = suggestDerivation(["gene_symbol", "score", "tissue"]);
  assert.equal(s.mappings.gene_symbol, "gene_symbol");
  assert.equal(s.mappings.score, "score");
  assert.equal(s.mappings.tissue, "tissue");
  assert.equal(s.centric, "gene");
  assert.equal(s.trait_scope, "constant");
  assert.equal(s.trait_column, undefined);
});

test("whole-token matches but never loose-substring", () => {
  // `snp_pos` → token `pos` IS a position match (desirable).
  const tok = suggestDerivation(["snp_pos", "gene"]);
  assert.equal(tok.mappings.position, "snp_pos");
  assert.equal(tok.mappings.gene_symbol, "gene");

  // `transposition` merely *contains* "pos" as a substring (no `pos`
  // token) — must NOT map to position.
  const sub = suggestDerivation(["transposition", "gene"]);
  assert.equal(sub.mappings.position, undefined);
  assert.equal(sub.mappings.gene_symbol, "gene");
});

test("each raw column used at most once", () => {
  const s = suggestDerivation(["gene", "p"]);
  const cols = Object.values(s.mappings);
  assert.equal(new Set(cols).size, cols.length);
});

test("empty input yields an empty, safe suggestion", () => {
  const s = suggestDerivation([]);
  assert.deepEqual(s.mappings, {});
  assert.equal(s.centric, "gene");
  assert.equal(s.trait_scope, "constant");
});
