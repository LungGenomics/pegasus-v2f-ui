// Evidence routing — for each evidence_block on a source, take the rows in
// raw_<id> and INSERT them into the unified `main.evidence` table with a
// constant source_tag + evidence_category and column mappings from
// block.fields.
//
// Mirrors cli/src/pegasus_v2f/evidence_loader.py but in SQL so it runs in
// DuckDB-WASM without a Python runtime.

import { getDataSource } from "../select";

// Heterogeneous YAML block shape carried through V2fEvidenceBlock — accept
// what the YAML actually has.
export type EvidenceBlock = {
  source_tag: string;
  evidence_category: string;
  centric?: string;
  role?: string;
  fields?: Record<string, unknown>;
  traits?: string[];
  // catch-all for whatever else the YAML dumped in
  [key: string]: unknown;
};

// --- Helpers ------------------------------------------------------------

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function strLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// Aliases the YAML configs use for evidence-side column names — collapse to
// the canonical evidence table column names.
const FIELD_ALIASES: Record<string, string> = {
  gene: "gene_symbol",
  gene_symbol: "gene_symbol",
  chr: "chromosome",
  chrom: "chromosome",
  chromosome: "chromosome",
  pos: "position",
  position: "position",
  rsid: "rsid",
  trait: "trait",
  pvalue: "pvalue",
  p: "pvalue",
  pval: "pvalue",
  effect_size: "effect_size",
  effect: "effect_size",
  beta: "effect_size",
  score: "score",
  tissue: "tissue",
  cell_type: "cell_type",
  ancestry: "ancestry",
  sex: "sex",
  evidence_stream: "evidence_stream",
  stream: "evidence_stream",
};

// Per-column SQL casts to coerce raw values into the evidence schema's types.
// Values that can't be coerced become NULL via TRY_CAST.
const COLUMN_CASTS: Record<string, (rawCol: string) => string> = {
  gene_symbol: (c) => `CAST(${c} AS VARCHAR)`,
  chromosome: (c) => `CAST(${c} AS VARCHAR)`,
  position: (c) => `TRY_CAST(${c} AS BIGINT)`,
  rsid: (c) => `CAST(${c} AS VARCHAR)`,
  trait: (c) => `CAST(${c} AS VARCHAR)`,
  pvalue: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  effect_size: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  score: (c) => `TRY_CAST(${c} AS DOUBLE)`,
  tissue: (c) => `CAST(${c} AS VARCHAR)`,
  cell_type: (c) => `CAST(${c} AS VARCHAR)`,
  ancestry: (c) => `CAST(${c} AS VARCHAR)`,
  sex: (c) => `CAST(${c} AS VARCHAR)`,
  evidence_stream: (c) => `CAST(${c} AS VARCHAR)`,
};

// --- Main routing -------------------------------------------------------

/** Resolve block.fields → { evidence_col → raw_col } using known aliases. */
function resolveMapping(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== "string") continue;
    const target = FIELD_ALIASES[k.toLowerCase()] ?? k;
    if (COLUMN_CASTS[target]) out[target] = v;
  }
  return out;
}

/** INSERT SQL for one evidence block. */
function buildInsertSql(block: EvidenceBlock, rawTable: string): string | null {
  const mapping = resolveMapping(block.fields ?? {});
  const geneCol = mapping["gene_symbol"];
  if (!geneCol) {
    // Without a gene column we can't populate evidence. Skip silently —
    // the caller logs a warning if no inserts happen.
    return null;
  }

  // Column order in the INSERT
  const targetCols = ["source_tag", "evidence_category"];
  const selects: string[] = [
    `${strLit(block.source_tag)} AS source_tag`,
    `${strLit(block.evidence_category)} AS evidence_category`,
  ];

  // Trait: per-row from the source table if mapping has it; otherwise
  // constant from block.traits (joined with ", ").
  const traitCol = mapping["trait"];
  const blockTraits = Array.isArray(block.traits) ? block.traits.join(", ") : null;
  if (traitCol) {
    targetCols.push("trait");
    selects.push(`${COLUMN_CASTS["trait"]!(ident(traitCol))} AS trait`);
  } else if (blockTraits) {
    targetCols.push("trait");
    selects.push(`${strLit(blockTraits)} AS trait`);
  }

  // The rest of the standard mapped columns. Skip ones we already added.
  for (const target of Object.keys(COLUMN_CASTS)) {
    if (target === "trait") continue;
    const raw = mapping[target];
    if (!raw) continue;
    targetCols.push(target);
    selects.push(`${COLUMN_CASTS[target]!(ident(raw))} AS ${ident(target)}`);
  }

  // Filter: gene must be non-null and not the literal string "nan" (pandas
  // artifact when Excel cells were blank).
  const where = `${ident(geneCol)} IS NOT NULL AND LOWER(CAST(${ident(geneCol)} AS VARCHAR)) <> 'nan' AND CAST(${ident(geneCol)} AS VARCHAR) <> ''`;

  return (
    `INSERT INTO main.evidence (${targetCols.map(ident).join(", ")}) ` +
    `SELECT ${selects.join(", ")} FROM main.${ident(rawTable)} ` +
    `WHERE ${where}`
  );
}

// --- Public API ---------------------------------------------------------

/** Clear existing evidence for a source_tag, then insert from raw_<id>. */
export async function loadEvidenceForBlock(
  block: EvidenceBlock,
  rawTable: string,
): Promise<{ rows: number; source_tag: string; skipped: boolean }> {
  const ds = getDataSource();
  const sql = buildInsertSql(block, rawTable);
  if (!sql) {
    return { rows: 0, source_tag: block.source_tag, skipped: true };
  }
  // Idempotency: clear any existing rows for this source_tag first.
  await ds.exec({
    sql: "DELETE FROM main.evidence WHERE source_tag = ?",
    params: [block.source_tag],
  });
  await ds.exec({ sql });
  const [count] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM main.evidence WHERE source_tag = ?",
    params: [block.source_tag],
  });
  return {
    rows: Number(count?.n ?? 0),
    source_tag: block.source_tag,
    skipped: false,
  };
}

export async function loadAllEvidenceBlocks(
  blocks: EvidenceBlock[],
  rawTable: string,
): Promise<{ rows: number; per_block: Array<{ source_tag: string; rows: number }> }> {
  let total = 0;
  const per_block: Array<{ source_tag: string; rows: number }> = [];
  for (const block of blocks) {
    const result = await loadEvidenceForBlock(block, rawTable);
    total += result.rows;
    per_block.push({ source_tag: result.source_tag, rows: result.rows });
  }
  return { rows: total, per_block };
}
