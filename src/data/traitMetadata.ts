// Admin trait-metadata writes for the Traits-page editor. Distinct from
// traitOps.upsertTrait (which coalesces and can never NULL a field):
// re-mapping and clearing must explicitly wipe stale enrichment, so these
// use direct UPDATEs. All writes are audit-stamped (actor = session login)
// and dirty the local config by virtue of touching config.traits.
//
// Resolution itself stays manual — the admin picks the OLS term; we never
// auto-guess. setTraitMapping applies the pick then runs enrichTrait to
// fill description / synonyms / hierarchy / xrefs / kind (+ OT for diseases).

import { getDataSource } from "./select";
import { getTrait, withTraitDereferenced } from "./traitOps";
import { enrichTrait } from "./ontology/enrich";
import type { OlsSearchResult } from "./ontology/ols";
import type { ConfigTrait } from "../api/types";

// Columns that describe the ontology mapping + everything enrichment derives
// from it. Reset together whenever the mapping changes or is cleared.
const RESET_ENRICHMENT =
  "xrefs = NULL, ontology_version = NULL, hierarchy_path = NULL, " +
  "ot_phenotypes = NULL, ot_drugs = NULL, ot_therapeutic_areas = NULL, " +
  "trait_kind = NULL, trait_kind_overridden = FALSE, last_enriched_at = NULL";

const BUMP = "last_edited_by = ?, row_version = row_version + 1, updated_at = now()";

/** Map a trait to an OLS term (or re-map it). Keeps the trait's existing,
 *  source-assigned label; sets the mapping, wipes any stale enrichment from
 *  a prior mapping, then enriches against the new term. */
export async function setTraitMapping(
  traitId: string,
  ols: OlsSearchResult,
  actor: string | null = null,
): Promise<void> {
  const trait = await getTrait(traitId);
  if (!trait) throw new Error(`Trait ${traitId} not found`);
  const ds = getDataSource();
  // Detach FK referrers for the duration of the write (incl. enrichment) — the
  // wasm engine can't UPDATE an FK-referenced trait row. See withTraitDereferenced.
  await withTraitDereferenced(traitId, async () => {
    await ds.exec({
      sql:
        "UPDATE config.traits SET " +
        "  primary_ontology = ?, primary_ontology_id = ?, ontology_label = ?, " +
        "  description = ?, synonyms = ?, " +
        RESET_ENRICHMENT +
        ", " +
        BUMP +
        " WHERE id = ?",
      params: [
        ols.ontology,
        ols.obo_id,
        ols.label,
        ols.description ?? null,
        ols.synonyms ? JSON.stringify(ols.synonyms) : null,
        actor,
        traitId,
      ],
    });
    // Repopulate description/synonyms/hierarchy/xrefs/kind (+OT) from the term.
    // Errors are swallowed inside enrichTrait — the mapping is already saved.
    // Each upstream fetch is time-bounded (see ontology clients) so a slow/dead
    // service (e.g. the deprecated OxO) can't stall this for minutes.
    await enrichTrait(traitId, actor);
  });
}

/** Clear a trait's ontology mapping → back to a bare, unmapped label.
 *  Wipes ontology fields, description, all enrichment, and any kind override. */
export async function clearTraitMapping(
  traitId: string,
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  await withTraitDereferenced(traitId, async () => {
    await ds.exec({
      sql:
        "UPDATE config.traits SET " +
        "  primary_ontology = NULL, primary_ontology_id = NULL, " +
        "  ontology_label = NULL, description = NULL, synonyms = NULL, " +
        RESET_ENRICHMENT +
        ", " +
        BUMP +
        " WHERE id = ?",
      params: [actor, traitId],
    });
  });
}

export type TraitKind = NonNullable<ConfigTrait["trait_kind"]>;

/** Set the trait_kind. A specific kind is an admin override (sticks through
 *  re-enrichment). "auto" clears the override and re-derives: re-infer from
 *  the ontology if mapped, else leave it null. */
export async function setTraitKind(
  traitId: string,
  kind: TraitKind | "auto",
  actor: string | null = null,
): Promise<void> {
  const ds = getDataSource();
  // Detach FK referrers for the duration — the wasm engine can't UPDATE an
  // FK-referenced trait row. See withTraitDereferenced.
  await withTraitDereferenced(traitId, async () => {
    if (kind !== "auto") {
      await ds.exec({
        sql:
          "UPDATE config.traits SET trait_kind = ?, trait_kind_overridden = TRUE, " +
          BUMP +
          " WHERE id = ?",
        params: [kind, actor, traitId],
      });
      return;
    }
    // auto: drop the override, then re-derive.
    await ds.exec({
      sql:
        "UPDATE config.traits SET trait_kind_overridden = FALSE, " +
        BUMP +
        " WHERE id = ?",
      params: [actor, traitId],
    });
    const trait = await getTrait(traitId);
    if (trait?.primary_ontology_id) {
      await enrichTrait(traitId, actor); // re-infers kind (override now off)
    } else {
      await ds.exec({
        sql: "UPDATE config.traits SET trait_kind = NULL WHERE id = ?",
        params: [traitId],
      });
    }
  });
}
