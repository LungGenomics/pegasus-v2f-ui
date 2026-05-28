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
import { CANONICAL_FIELDS } from "../canonicalFields";
import type { ConfigMapping } from "../../api/types";

function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function strLit(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// One canonical-column SELECT-item for a mapping: alias the assigned raw
// column, or NULL if the mapping doesn't map this field.
function fieldExpr(mapping: ConfigMapping, field: string): string {
  const f = (mapping.fields ?? []).find((x) => x.canonical_field === field);
  return f ? `${ident(f.raw_column)} AS ${ident(field)}` : `NULL AS ${ident(field)}`;
}

// trait_id projection for a single trait literal (or a column/NULL). Returns
// the SQL expression that yields the row's trait_id.
function traitIdExpr(traitId: string | null): string {
  return traitId ? `CAST(${strLit(traitId)} AS UUID) AS trait_id` : `NULL AS trait_id`;
}

/** SELECT(s) projecting one mapping into the canonical evidence shape. A
 *  constant mapping with N traits returns N SELECTs (one row per trait);
 *  every other case returns exactly one. Returns [] for a mapping that can't
 *  project (e.g. no fields yet). */
function projectionsFor(mapping: ConfigMapping, pipeline: string): string[] {
  const cols = CANONICAL_FIELDS.map((f) => fieldExpr(mapping, f));
  const tail = [
    `${strLit(mapping.evidence_category ?? "")} AS evidence_category`,
    `${strLit(mapping.source_tag)} AS source_tag`,
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
      selects.push(...projectionsFor(m, pipeline));
    }
  }

  if (selects.length === 0) {
    // No evidence mappings yet — a typed-but-empty view so joins resolve.
    const cols = [
      ...CANONICAL_FIELDS.map((f) => `CAST(NULL AS VARCHAR) AS ${ident(f)}`),
      `CAST(NULL AS VARCHAR) AS evidence_category`,
      `CAST(NULL AS VARCHAR) AS source_tag`,
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
