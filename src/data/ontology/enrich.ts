// Trait enrichment pipeline. Stage 1 (always run when a trait is
// mapped) pulls description / synonyms / hierarchy / trait_kind from
// OLS. Stage 2 (disease traits only) pulls phenotypes / drugs /
// therapeutic areas from OpenTargets.
//
// Stage failures degrade silently — a trait can be partially enriched
// (Stage 1 succeeded, Stage 2 failed) and still be useful. The
// `last_enriched_at` timestamp marks whichever stages we attempted.

import { getTrait, upsertTrait } from "../traitOps";
import { fetchAncestors, fetchTermDetails, inferTraitKind } from "./ols";
import { fetchMappings } from "./oxo";
import { fetchDiseaseEnrichment } from "./opentargets";
import type { ConfigTrait } from "../../api/types";

export interface EnrichResult {
  trait_id: string;
  label: string;
  stage1_ok: boolean;
  stage2_ok: boolean;
  stage2_skipped: boolean;
  trait_kind?: ConfigTrait["trait_kind"];
}

/** Run the full enrichment for one trait. Looks up the trait by id,
 *  runs Stage 1 (OLS + OXO), and if `trait_kind` resolves to "disease"
 *  also runs Stage 2 (OT GraphQL). Writes results back via
 *  upsertTrait. Idempotent — re-running pulls fresh data from each
 *  source. */
export async function enrichTrait(traitId: string): Promise<EnrichResult> {
  const trait = await getTrait(traitId);
  if (!trait) throw new Error(`Trait ${traitId} not found`);

  const result: EnrichResult = {
    trait_id: traitId,
    label: trait.label,
    stage1_ok: false,
    stage2_ok: false,
    stage2_skipped: false,
  };

  // Stage 1: always attempted when an ontology mapping exists. Bare
  // unmapped traits skip both stages.
  if (!trait.primary_ontology || !trait.primary_ontology_id) {
    result.stage2_skipped = true;
    return result;
  }
  const stage1 = await runStage1(trait);
  if (stage1) {
    result.stage1_ok = true;
    result.trait_kind = stage1.trait_kind;
  }

  // Stage 2 — disease traits only. inferTraitKind may also return
  // "phenotype" or "measurement"; only diseases have OT phenotype/drug
  // data worth fetching.
  const kind = stage1?.trait_kind ?? trait.trait_kind;
  if (kind !== "disease") {
    result.stage2_skipped = true;
    return result;
  }
  const stage2 = await runStage2(trait);
  if (stage2) result.stage2_ok = true;

  return result;
}

interface Stage1Result {
  trait_kind?: ConfigTrait["trait_kind"];
}

async function runStage1(trait: ConfigTrait): Promise<Stage1Result | null> {
  const ontology = trait.primary_ontology?.toLowerCase();
  const ontId = trait.primary_ontology_id;
  if (!ontology || !ontId) return null;

  const [details, ancestors, xrefs] = await Promise.all([
    fetchTermDetails(ontology, ontId).catch(() => null),
    fetchAncestors(ontology, ontId).catch(() => []),
    fetchMappings(ontId).catch(() => []),
  ]);

  const trait_kind = inferTraitKind(ancestors);

  await upsertTrait({
    label: trait.label,
    description: details?.description ?? trait.description,
    ontology_label: details?.label ?? trait.ontology_label,
    synonyms: details?.synonyms ?? trait.synonyms,
    hierarchy_path: ancestors,
    xrefs: xrefs.length > 0 ? xrefs : trait.xrefs,
    trait_kind,
    last_enriched_at: new Date().toISOString(),
    // Preserve fields we don't touch
    primary_ontology: trait.primary_ontology,
    primary_ontology_id: trait.primary_ontology_id,
  });

  return { trait_kind };
}

async function runStage2(trait: ConfigTrait): Promise<boolean> {
  const ontId = trait.primary_ontology_id;
  if (!ontId) return false;
  const enrichment = await fetchDiseaseEnrichment(ontId);
  if (!enrichment) return false;
  await upsertTrait({
    label: trait.label,
    ot_phenotypes: enrichment.ot_phenotypes,
    ot_drugs: enrichment.ot_drugs,
    ot_therapeutic_areas: enrichment.ot_therapeutic_areas,
    last_enriched_at: new Date().toISOString(),
    // Preserve other fields populated by Stage 1
    primary_ontology: trait.primary_ontology,
    primary_ontology_id: trait.primary_ontology_id,
    trait_kind: trait.trait_kind ?? "disease",
  });
  return true;
}

/** Batch enrichment with throttling. Used by the /traits page's
 *  "Refresh enrichment" button. Skips traits enriched within
 *  `staleAfterDays` (default 30) unless `force` is set. */
export async function enrichTraits(
  traitIds: string[],
  options: { staleAfterDays?: number; force?: boolean } = {},
): Promise<EnrichResult[]> {
  const staleMs = (options.staleAfterDays ?? 30) * 24 * 3600 * 1000;
  const cutoff = Date.now() - staleMs;
  const out: EnrichResult[] = [];
  // Conservative throttle — OT is the bottleneck. Stage 1 only hits
  // OLS/OXO which are lighter, but the same call site might run Stage
  // 2 so we use OT's rate.
  for (const id of traitIds) {
    const trait = await getTrait(id);
    if (!trait) continue;
    if (!options.force && trait.last_enriched_at) {
      const enrichedAt = Date.parse(trait.last_enriched_at);
      if (Number.isFinite(enrichedAt) && enrichedAt > cutoff) {
        out.push({
          trait_id: id,
          label: trait.label,
          stage1_ok: false,
          stage2_ok: false,
          stage2_skipped: true,
        });
        continue;
      }
    }
    out.push(await enrichTrait(id));
    // Throttle: ~1 trait per second when Stage 2 runs.
    await new Promise((r) => setTimeout(r, 1000));
  }
  return out;
}
