// OpenTargets GraphQL API wrapper. Public endpoint at
// https://api.platform.opentargets.org/api/v4/graphql.
//
// Single query covers everything we need for disease-trait enrichment:
// associated phenotypes (HPO via HPOA + Orphanet + DECIPHER curation),
// known drugs (ChEMBL), and therapeutic areas (top-level disease
// categories).
//
// CORS is OK from the browser. Rate limits are per-IP and aggressive
// in bulk — `throttledMap` here drops to ~1 req/sec by default for
// batch ops.

import type { TraitDrug, TraitPhenotype } from "../../api/types";

const OT_GRAPHQL_URL = "https://api.platform.opentargets.org/api/v4/graphql";

export interface DiseaseEnrichment {
  ot_id: string;
  ot_name: string;
  ot_therapeutic_areas: string[];
  ot_phenotypes: TraitPhenotype[];
  ot_drugs: TraitDrug[];
}

interface OtResponse {
  data?: {
    disease?: {
      id?: string;
      name?: string;
      therapeuticAreas?: Array<{ id?: string; name?: string }>;
      phenotypes?: {
        rows?: Array<{
          phenotype?: { id?: string; name?: string };
          evidence?: Array<{
            aspect?: string;
            frequency?: { name?: string };
            onset?: Array<{ name?: string }>;
            modifiers?: Array<{ name?: string }>;
          }>;
        }>;
      };
      knownDrugs?: {
        rows?: Array<{
          drug?: {
            id?: string;
            name?: string;
            maximumClinicalTrialPhase?: number;
            mechanismsOfAction?: {
              rows?: Array<{ mechanismOfAction?: string }>;
            };
          };
        }>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

const QUERY = `
query DiseaseEnrichment($efoId: String!) {
  disease(efoId: $efoId) {
    id
    name
    therapeuticAreas { id name }
    phenotypes(page: { index: 0, size: 100 }) {
      rows {
        phenotype { id name }
        evidence {
          aspect
          frequency { name }
          onset { name }
          modifiers { name }
        }
      }
    }
    knownDrugs(size: 50) {
      rows {
        drug {
          id
          name
          maximumClinicalTrialPhase
          mechanismsOfAction {
            rows { mechanismOfAction }
          }
        }
      }
    }
  }
}
`;

/** Fetch disease enrichment data for one EFO/MONDO ID. Returns null if
 *  the term isn't in OT, OT returned an error, or the network failed —
 *  all degrade silently so the caller can still save what OLS found. */
export async function fetchDiseaseEnrichment(
  ontologyId: string,
): Promise<DiseaseEnrichment | null> {
  // OT expects the underscore form ("EFO_0004713" or "MONDO_0005002").
  const efoId = ontologyId.replace(":", "_");
  let res: Response;
  try {
    res = await fetch(OT_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: QUERY, variables: { efoId } }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data: OtResponse;
  try {
    data = (await res.json()) as OtResponse;
  } catch {
    return null;
  }
  const d = data.data?.disease;
  if (!d?.id || !d.name) return null;

  const ot_therapeutic_areas =
    d.therapeuticAreas?.map((a) => a.name ?? a.id ?? "").filter(Boolean) ?? [];

  const ot_phenotypes: TraitPhenotype[] = [];
  for (const row of d.phenotypes?.rows ?? []) {
    const pheno = row.phenotype;
    if (!pheno?.id || !pheno.name) continue;
    const ev = row.evidence?.[0];
    const phenotype: TraitPhenotype = {
      hpo_id: pheno.id,
      label: pheno.name,
    };
    const freq = ev?.frequency?.name;
    if (freq) phenotype.frequency = freq;
    const onset = ev?.onset?.[0]?.name;
    if (onset) phenotype.onset = onset;
    const modifier = ev?.modifiers?.[0]?.name;
    if (modifier) phenotype.modifier = modifier;
    ot_phenotypes.push(phenotype);
  }

  const ot_drugs: TraitDrug[] = [];
  for (const row of d.knownDrugs?.rows ?? []) {
    const drug = row.drug;
    if (!drug?.id || !drug.name) continue;
    const drugOut: TraitDrug = {
      chembl_id: drug.id,
      name: drug.name,
    };
    if (typeof drug.maximumClinicalTrialPhase === "number") {
      drugOut.max_phase = drug.maximumClinicalTrialPhase;
    }
    const moa = drug.mechanismsOfAction?.rows?.[0]?.mechanismOfAction;
    if (moa) drugOut.mechanism_of_action = moa;
    ot_drugs.push(drugOut);
  }

  return {
    ot_id: d.id,
    ot_name: d.name,
    ot_therapeutic_areas,
    ot_phenotypes,
    ot_drugs,
  };
}

/** Throttle a list of work units to N per second. Used for batch
 *  enrichment so we respect OT's per-IP rate limits. */
export async function throttledMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  options: { perSecond?: number } = {},
): Promise<R[]> {
  const perSecond = options.perSecond ?? 1;
  const intervalMs = Math.max(50, Math.floor(1000 / perSecond));
  const out: R[] = [];
  for (const item of items) {
    const start = Date.now();
    out.push(await fn(item));
    const elapsed = Date.now() - start;
    const wait = intervalMs - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  return out;
}
