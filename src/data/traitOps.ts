// Trait read+write ops. Canonical phenotype entities backed (optionally)
// by an ontology — see plan 2026-05-11-config-redesign-web-first.md.
// Enrichment (description, synonyms, hierarchy, OT phenotypes/drugs)
// runs via src/data/ontology/* modules; this file just persists
// whatever those modules return.

import { getDataSource } from "./select";
import type {
  ConfigTrait,
  TraitDrug,
  TraitHierarchyNode,
  TraitPhenotype,
  TraitXref,
} from "../api/types";

type TraitRow = {
  id: string;
  label: string;
  description: string | null;
  primary_ontology: string | null;
  primary_ontology_id: string | null;
  ontology_label: string | null;
  xrefs: string | TraitXref[] | null;
  ontology_version: string | null;
  parent_trait_id: string | null;
  trait_kind: string | null;
  trait_kind_overridden: boolean | null;
  synonyms: string | string[] | null;
  hierarchy_path: string | TraitHierarchyNode[] | null;
  ot_phenotypes: string | TraitPhenotype[] | null;
  ot_drugs: string | TraitDrug[] | null;
  ot_therapeutic_areas: string | string[] | null;
  last_enriched_at: string | null;
  row_version: number;
  created_by: string | null;
  last_edited_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function parseArray<T>(v: string | T[] | null | undefined): T[] | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return Array.isArray(v) ? v : undefined;
}

function rowToTrait(row: TraitRow): ConfigTrait {
  const out: ConfigTrait = {
    id: row.id,
    label: row.label,
    row_version: Number(row.row_version),
  };
  if (row.description != null) out.description = row.description;
  if (row.primary_ontology != null) out.primary_ontology = row.primary_ontology;
  if (row.primary_ontology_id != null)
    out.primary_ontology_id = row.primary_ontology_id;
  if (row.ontology_label != null) out.ontology_label = row.ontology_label;
  const xrefs = parseArray<TraitXref>(row.xrefs);
  if (xrefs) out.xrefs = xrefs;
  if (row.ontology_version != null) out.ontology_version = row.ontology_version;
  if (row.parent_trait_id != null) out.parent_trait_id = row.parent_trait_id;
  if (row.trait_kind != null) {
    out.trait_kind = row.trait_kind as ConfigTrait["trait_kind"];
  }
  if (row.trait_kind_overridden != null)
    out.trait_kind_overridden = Boolean(row.trait_kind_overridden);
  const syns = parseArray<string>(row.synonyms);
  if (syns) out.synonyms = syns;
  const hier = parseArray<TraitHierarchyNode>(row.hierarchy_path);
  if (hier) out.hierarchy_path = hier;
  const phens = parseArray<TraitPhenotype>(row.ot_phenotypes);
  if (phens) out.ot_phenotypes = phens;
  const drugs = parseArray<TraitDrug>(row.ot_drugs);
  if (drugs) out.ot_drugs = drugs;
  const tas = parseArray<string>(row.ot_therapeutic_areas);
  if (tas) out.ot_therapeutic_areas = tas;
  if (row.last_enriched_at != null) out.last_enriched_at = row.last_enriched_at;
  if (row.created_by != null) out.created_by = row.created_by;
  if (row.last_edited_by != null) out.last_edited_by = row.last_edited_by;
  if (row.created_at != null) out.created_at = row.created_at;
  if (row.updated_at != null) out.updated_at = row.updated_at;
  return out;
}

const TRAIT_COLS =
  "id, label, description, primary_ontology, primary_ontology_id, " +
  "ontology_label, xrefs, ontology_version, parent_trait_id, " +
  "trait_kind, trait_kind_overridden, synonyms, hierarchy_path, " +
  "ot_phenotypes, ot_drugs, " +
  "ot_therapeutic_areas, last_enriched_at, row_version, " +
  "created_by, last_edited_by, created_at, updated_at";

// --- READS ---

export async function listTraits(): Promise<ConfigTrait[]> {
  const ds = getDataSource();
  const rows = await ds.query<TraitRow>({
    sql: `SELECT ${TRAIT_COLS} FROM config.traits ORDER BY label`,
  });
  return rows.map(rowToTrait);
}

export async function getTrait(id: string): Promise<ConfigTrait | null> {
  const ds = getDataSource();
  const rows = await ds.query<TraitRow>({
    sql: `SELECT ${TRAIT_COLS} FROM config.traits WHERE id = ? LIMIT 1`,
    params: [id],
  });
  return rows[0] ? rowToTrait(rows[0]) : null;
}

export async function getTraitByLabel(
  label: string,
): Promise<ConfigTrait | null> {
  const ds = getDataSource();
  const rows = await ds.query<TraitRow>({
    sql: `SELECT ${TRAIT_COLS} FROM config.traits WHERE label = ? LIMIT 1`,
    params: [label],
  });
  return rows[0] ? rowToTrait(rows[0]) : null;
}

// --- WRITES ---

export interface UpsertTraitInput {
  label: string;
  description?: string;
  primary_ontology?: string;
  primary_ontology_id?: string;
  ontology_label?: string;
  xrefs?: TraitXref[];
  ontology_version?: string;
  parent_trait_id?: string;
  trait_kind?: ConfigTrait["trait_kind"];
  trait_kind_overridden?: boolean;
  synonyms?: string[];
  hierarchy_path?: TraitHierarchyNode[];
  ot_phenotypes?: TraitPhenotype[];
  ot_drugs?: TraitDrug[];
  ot_therapeutic_areas?: string[];
  last_enriched_at?: string;
}

/** Find a trait by label, or create a bare one with just the label.
 *  Used by the per-row trait-column derivation pipeline when it
 *  encounters a label it hasn't seen before. Returns the trait_id. */
export async function findOrCreateByLabel(
  label: string,
  actor: string | null = null,
): Promise<string> {
  const existing = await getTraitByLabel(label);
  if (existing) return existing.id;
  const ds = getDataSource();
  const [row] = await ds.query<{ id: string }>({
    sql:
      "INSERT INTO config.traits (label, created_by, last_edited_by) " +
      "VALUES (?, ?, ?) RETURNING id",
    params: [label, actor, actor],
  });
  if (!row) throw new Error("INSERT config.traits returned no rows");
  return row.id;
}

/** Insert-or-replace a trait by label. The enrichment pipeline calls
 *  this after fetching from OLS/OXO/OT — every enriched field becomes
 *  a column update. */
export async function upsertTrait(
  input: UpsertTraitInput,
  actor: string | null = null,
): Promise<string> {
  const ds = getDataSource();
  const existing = await getTraitByLabel(input.label);
  if (existing) {
    await ds.exec({
      sql:
        "UPDATE config.traits SET " +
        "  description = ?, primary_ontology = ?, primary_ontology_id = ?, " +
        "  ontology_label = ?, xrefs = ?, ontology_version = ?, " +
        "  parent_trait_id = ?, trait_kind = ?, " +
        "  trait_kind_overridden = ?, synonyms = ?, " +
        "  hierarchy_path = ?, ot_phenotypes = ?, ot_drugs = ?, " +
        "  ot_therapeutic_areas = ?, last_enriched_at = ?, " +
        "  last_edited_by = ?, " +
        "  row_version = row_version + 1, updated_at = now() " +
        "WHERE id = ?",
      params: [
        input.description ?? existing.description ?? null,
        input.primary_ontology ?? existing.primary_ontology ?? null,
        input.primary_ontology_id ?? existing.primary_ontology_id ?? null,
        input.ontology_label ?? existing.ontology_label ?? null,
        input.xrefs ? JSON.stringify(input.xrefs) : null,
        input.ontology_version ?? existing.ontology_version ?? null,
        input.parent_trait_id ?? existing.parent_trait_id ?? null,
        input.trait_kind ?? existing.trait_kind ?? null,
        input.trait_kind_overridden ?? existing.trait_kind_overridden ?? false,
        input.synonyms ? JSON.stringify(input.synonyms) : null,
        input.hierarchy_path ? JSON.stringify(input.hierarchy_path) : null,
        input.ot_phenotypes ? JSON.stringify(input.ot_phenotypes) : null,
        input.ot_drugs ? JSON.stringify(input.ot_drugs) : null,
        input.ot_therapeutic_areas
          ? JSON.stringify(input.ot_therapeutic_areas)
          : null,
        input.last_enriched_at ?? existing.last_enriched_at ?? null,
        actor,
        existing.id,
      ],
    });
    return existing.id;
  }

  const [row] = await ds.query<{ id: string }>({
    sql:
      "INSERT INTO config.traits " +
      "  (label, description, primary_ontology, primary_ontology_id, " +
      "   ontology_label, xrefs, ontology_version, parent_trait_id, " +
      "   trait_kind, trait_kind_overridden, synonyms, hierarchy_path, " +
      "   ot_phenotypes, ot_drugs, " +
      "   ot_therapeutic_areas, last_enriched_at, created_by, last_edited_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    params: [
      input.label,
      input.description ?? null,
      input.primary_ontology ?? null,
      input.primary_ontology_id ?? null,
      input.ontology_label ?? null,
      input.xrefs ? JSON.stringify(input.xrefs) : null,
      input.ontology_version ?? null,
      input.parent_trait_id ?? null,
      input.trait_kind ?? null,
      input.trait_kind_overridden ?? false,
      input.synonyms ? JSON.stringify(input.synonyms) : null,
      input.hierarchy_path ? JSON.stringify(input.hierarchy_path) : null,
      input.ot_phenotypes ? JSON.stringify(input.ot_phenotypes) : null,
      input.ot_drugs ? JSON.stringify(input.ot_drugs) : null,
      input.ot_therapeutic_areas
        ? JSON.stringify(input.ot_therapeutic_areas)
        : null,
      input.last_enriched_at ?? null,
      actor,
      actor,
    ],
  });
  if (!row) throw new Error("INSERT config.traits returned no rows");
  return row.id;
}

export async function removeTrait(id: string): Promise<void> {
  const ds = getDataSource();
  // Block deletion when traits are referenced — FKs will error anyway,
  // but a clear message is friendlier.
  const [{ n: refSource } = { n: 0 }] = await ds.query<{ n: number }>({
    sql: "SELECT COUNT(*) AS n FROM config.source_traits WHERE trait_id = ?",
    params: [id],
  });
  const [{ n: refDeriv } = { n: 0 }] = await ds.query<{ n: number }>({
    sql:
      "SELECT COUNT(*) AS n FROM config.derivation_traits WHERE trait_id = ?",
    params: [id],
  });
  const refs = Number(refSource) + Number(refDeriv);
  if (refs > 0) {
    throw new Error(
      `Cannot remove trait — still referenced by ${refs} source/derivation association(s).`,
    );
  }
  await ds.exec({
    sql: "DELETE FROM config.traits WHERE id = ?",
    params: [id],
  });
}

export interface TraitUsage {
  /** Sources that declared this trait (config.source_traits). */
  sources: Array<{ name: string; display_name: string | null }>;
  /** Derivations that carry this trait constantly
   *  (config.derivation_traits). Per-row column-scope derivations
   *  resolve traits by label at build time and aren't listed here. */
  derivations: Array<{ source_tag: string; evidence_category: string }>;
}

/** Where a trait is referenced across config — drives the "Used by"
 *  section of the trait detail panel. */
export async function getTraitUsage(traitId: string): Promise<TraitUsage> {
  const ds = getDataSource();
  const [sources, derivations] = await Promise.all([
    ds.query<{ name: string; display_name: string | null }>({
      sql:
        "SELECT s.name, s.display_name " +
        "FROM config.source_traits st " +
        "JOIN config.sources s ON s.id = st.source_id " +
        "WHERE st.trait_id = ? ORDER BY s.name",
      params: [traitId],
    }),
    ds.query<{ source_tag: string; evidence_category: string }>({
      sql:
        "SELECT d.source_tag, d.evidence_category " +
        "FROM config.derivation_traits dt " +
        "JOIN config.derivations d ON d.id = dt.derivation_id " +
        "WHERE dt.trait_id = ? ORDER BY d.source_tag",
      params: [traitId],
    }),
  ]);
  return { sources, derivations };
}

/** Delete junk traits: unmapped (no ontology) AND referenced by
 *  nothing — not declared on a source, not a constant on a derivation,
 *  not present in main.evidence, and not a parent of another trait.
 *
 *  Mapped traits (primary_ontology_id set) are spared even when
 *  unreferenced, since those were deliberately picked via OLS and may
 *  just not be attached to a source yet. NOT EXISTS (not NOT IN) so
 *  NULLs don't suppress the whole predicate. Returns the count removed. */
export async function pruneJunkTraits(): Promise<number> {
  const ds = getDataSource();
  const { tableExists } = await import("./select");
  const evidenceClause = (await tableExists("evidence"))
    ? "AND NOT EXISTS (SELECT 1 FROM main.evidence e WHERE e.trait_id = t.id) "
    : "";
  const where =
    "t.primary_ontology_id IS NULL " +
    "AND NOT EXISTS (SELECT 1 FROM config.source_traits st WHERE st.trait_id = t.id) " +
    "AND NOT EXISTS (SELECT 1 FROM config.derivation_traits dt WHERE dt.trait_id = t.id) " +
    "AND NOT EXISTS (SELECT 1 FROM config.traits c WHERE c.parent_trait_id = t.id) " +
    evidenceClause;

  const [{ n } = { n: 0 }] = await ds.query<{ n: number }>({
    sql: `SELECT COUNT(*) AS n FROM config.traits t WHERE ${where}`,
  });
  const count = Number(n);
  if (count > 0) {
    await ds.exec({
      sql: `DELETE FROM config.traits AS t WHERE ${where}`,
    });
  }
  return count;
}
