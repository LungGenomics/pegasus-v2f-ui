// Build the `main.evidence` view — the canonical, unioned evidence table the
// Explore data layer (and loci / locus_evidence) read from.
// Plan: 2026-05-28-explore-data-layer.md.
//
// `evidence` is a VIEW, not a table: it recomputes from the current mappings
// each query (edit a mapping → evidence reflects it, no rebuild). Its text is
// dynamic in the mapping set, so it must be regenerated whenever mappings or
// transforms change (buildEvidenceView).
//
// Each evidence-target mapping projects its (transform-cleaned) source into
// the fixed 15-column canonical shape:
//   12 user-mapped (CANONICAL_FIELDS) + evidence_category + source_tag + trait_id
// Columns a mapping doesn't assign are NULL-padded so every projection is
// UNION-compatible. Constant multi-trait mappings fan out one row per trait.

import { getDataSource } from "../select";
import { buildTransformedPipeline } from "../rawData";
import { listSources } from "../sourceOps";
import { listMappingsForSource } from "../mappingOps";
import { findOrCreateByLabel } from "../traitOps";
import { CANONICAL_FIELDS } from "../canonicalFields";
import type { ConfigMapping } from "../../api/types";

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function strLit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// One canonical-column SELECT-item for a mapping: alias the assigned raw
// column, or NULL if the mapping doesn't map this field (or maps it to a blank
// column — a leftover empty field row, e.g. gene_symbol seeded then unused on a
// variant-centric mapping; emitting ident("") would be a zero-length identifier
// SQL error).
function fieldExpr(mapping: ConfigMapping, field: string): string {
  const f = (mapping.fields ?? []).find((x) => x.canonical_field === field);
  const col = f?.raw_column?.trim();
  // Qualify with the pipeline alias (_src): when col === field (e.g.
  // gene_symbol AS gene_symbol) AND the SELECT has a join (column-scope trait
  // resolution), an unqualified ref can bind to the not-yet-defined output
  // alias on stricter binders (DuckDB-WASM) → "referenced before it is defined".
  return col
    ? `_src.${ident(col)} AS ${ident(field)}`
    : `NULL AS ${ident(field)}`;
}

// primary_value / secondary_value alias the mapping's chosen value columns —
// plain columns, NO calculation (derivations live in the transform pipeline).
// Open numerics: required (primary) for evidence mappings, NULL when unset /
// for loci mappings.
function valueExpr(col: string | undefined, alias: string): string {
  const c = col?.trim();
  return c ? `_src.${ident(c)} AS ${ident(alias)}` : `NULL AS ${ident(alias)}`;
}

// Optional value label literal — describes what the value is. NULL when unset.
function labelLit(label: string | undefined): string {
  const s = label?.trim();
  return s ? strLit(s) : "NULL";
}

// trait_id projection for a single trait literal (or a column/NULL). Returns
// the SQL expression that yields the row's trait_id.
function traitIdExpr(traitId: string | null): string {
  return traitId ? `CAST(${strLit(traitId)} AS UUID) AS trait_id` : `NULL AS trait_id`;
}

/** SELECT(s) projecting one mapping into the canonical evidence shape (the 15
 *  columns), reading from its transform-cleaned `pipeline` SQL. A constant
 *  mapping with N traits returns N SELECTs (one row per trait); every other
 *  case returns exactly one. Shared by the evidence view (evidence mappings)
 *  and the loci builder (loci mappings project the same canonical shape to
 *  get chromosome/position/rsid/pvalue for window+merge). */
export function mappingProjections(
  mapping: ConfigMapping,
  pipeline: string,
): string[] {
  const cols = [
    // Match keys + attributes (all column-mapped now — no special cases).
    ...CANONICAL_FIELDS.map((f) => fieldExpr(mapping, f)),
    // The open per-category values.
    valueExpr(mapping.primary_value_column, "primary_value"),
    valueExpr(mapping.secondary_value_column, "secondary_value"),
  ];
  const tail = [
    `${strLit(mapping.evidence_category ?? "")} AS evidence_category`,
    `${strLit(mapping.source_tag)} AS source_tag`,
    // Per-mapping value labels (literals; describe what each value is).
    `${labelLit(mapping.primary_value_label)} AS primary_value_label`,
    `${labelLit(mapping.secondary_value_label)} AS secondary_value_label`,
    // centric routing meta: 'variant' fans to a locus's candidate genes by
    // position; anything else is gene-keyed. Defaults to 'gene'.
    `${strLit(mapping.centric === "variant" ? "variant" : "gene")} AS centric`,
  ];

  // trait_id source:
  //  - constant scope → one row per mapping_traits.trait_id (fan-out)
  //  - column scope   → resolve per-row from the raw trait column. If a
  //    trait_id_lookup column is present use it directly; else map the label
  //    via config.traits (LEFT JOIN). Unmatched → NULL (no auto-create here).
  //  - none           → NULL trait_id
  const select = (traitExpr: string, extraJoin = ""): string =>
    `SELECT ${[...cols, ...tail, traitExpr].join(", ")} ` +
    `FROM (${pipeline}) _src${extraJoin}`;

  if (mapping.trait_scope === "constant") {
    const ids = mapping.trait_ids ?? [];
    if (ids.length === 0) return [select(traitIdExpr(null))];
    return ids.map((id) => select(traitIdExpr(id)));
  }

  if (mapping.trait_scope === "column" && mapping.trait_column) {
    const tc = mapping.trait_column;
    if (tc.trait_id_lookup) {
      return [
        select(`CAST(_src.${ident(tc.trait_id_lookup)} AS UUID) AS trait_id`),
      ];
    }
    // Map the per-row label to a trait_id via config.traits.label.
    const join = ` LEFT JOIN config.traits _t ON _t.label = _src.${ident(tc.raw_column)}`;
    return [select(`_t.id AS trait_id`, join)];
  }

  return [select(traitIdExpr(null))];
}

/** For column-scope evidence mappings (trait read per-row from a column,
 *  no trait_id_lookup), register each DISTINCT label in that column as a trait
 *  in config.traits. Without this the evidence view's label→trait_id join
 *  finds nothing and the Traits list is empty. Idempotent
 *  (findOrCreateByLabel). Returns the number of distinct labels seen. Run
 *  BEFORE buildEvidenceView so the join resolves. */
export async function ensureColumnScopeTraits(
  actor: string | null = null,
): Promise<number> {
  const ds = getDataSource();
  const sources = await listSources();
  let seen = 0;
  for (const src of sources) {
    const mappings = await listMappingsForSource(src.id);
    const colMappings = mappings.filter(
      (m) =>
        // Both evidence AND loci column-scope mappings resolve trait by label
        // (loci drop variants with a NULL trait_id), so register labels for both.
        (m.target === "evidence" || m.target === "loci") &&
        m.trait_scope === "column" &&
        m.trait_column &&
        !m.trait_column.trait_id_lookup,
    );
    if (colMappings.length === 0) continue;
    const pipeline = await buildTransformedPipeline(src.id);
    for (const m of colMappings) {
      const col = m.trait_column!.raw_column;
      const rows = await ds.query<{ label: string }>({
        sql:
          `SELECT DISTINCT ${ident(col)} AS label FROM (${pipeline}) ` +
          `WHERE ${ident(col)} IS NOT NULL`,
      });
      for (const r of rows) {
        const label = String(r.label ?? "").trim();
        if (label) {
          // Signs at creation via the threaded actor. No backfill — pre-fix
          // unsigned rows clear on a fresh rebuild (dev: nuke + recreate).
          await findOrCreateByLabel(label, actor);
          seen += 1;
        }
      }
    }
  }
  return seen;
}

/** (Re)create main.evidence from the current evidence-target mappings.
 *  Drops to an empty-shaped view when there are no evidence mappings so
 *  downstream views/queries still resolve. */
export async function buildEvidenceView(): Promise<void> {
  const ds = getDataSource();
  const sources = await listSources();

  const selects: string[] = [];
  for (const src of sources) {
    const mappings = await listMappingsForSource(src.id);
    const evMappings = mappings.filter((m) => m.target === "evidence");
    if (evMappings.length === 0) continue;
    const pipeline = await buildTransformedPipeline(src.id);
    for (const m of evMappings) {
      selects.push(...mappingProjections(m, pipeline));
    }
  }

  if (selects.length === 0) {
    // No evidence mappings yet — a typed-but-empty view so joins resolve.
    const cols = [
      ...CANONICAL_FIELDS.map((f) => `CAST(NULL AS VARCHAR) AS ${ident(f)}`),
      `CAST(NULL AS VARCHAR) AS primary_value`,
      `CAST(NULL AS VARCHAR) AS secondary_value`,
      `CAST(NULL AS VARCHAR) AS evidence_category`,
      `CAST(NULL AS VARCHAR) AS source_tag`,
      `CAST(NULL AS VARCHAR) AS primary_value_label`,
      `CAST(NULL AS VARCHAR) AS secondary_value_label`,
      `CAST(NULL AS VARCHAR) AS centric`,
      `CAST(NULL AS UUID) AS trait_id`,
    ];
    await ds.exec({
      sql: `CREATE OR REPLACE VIEW main.evidence AS SELECT ${cols.join(", ")} WHERE FALSE`,
    });
    return;
  }

  await ds.exec({
    sql: `CREATE OR REPLACE VIEW main.evidence AS ${selects.join(" UNION ALL ")}`,
  });
}
