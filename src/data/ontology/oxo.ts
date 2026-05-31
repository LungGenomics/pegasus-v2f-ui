// OXO cross-reference API wrapper. Hosted by EBI at
// https://www.ebi.ac.uk/spot/oxo/api/. Given an ID in any supported
// ontology, returns mapped IDs in other ontologies (MONDO, MeSH, UMLS,
// ICD-10, SNOMED, etc.).
//
// Used at trait-save time to populate config.traits.xrefs once the
// user has picked a primary ontology term.

import type { TraitXref } from "../../api/types";

const OXO_BASE = "https://www.ebi.ac.uk/spot/oxo/api";

const cache = new Map<string, TraitXref[]>();

interface OxoMappingsResponse {
  _embedded?: {
    mappings?: Array<{
      fromTerm?: { curie?: string; label?: string };
      toTerm?: { curie?: string; label?: string };
      distance?: number;
    }>;
  };
}

// OxO (EBI SPOT) is a deprecated service and now frequently slow/unresponsive.
// Bound the request so a hang can't stall trait enrichment — callers already
// degrade to an empty xref list on any error (including a timeout abort).
const OXO_TIMEOUT_MS = 6000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(OXO_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `OXO request failed (${res.status} ${res.statusText}): ${url}`,
    );
  }
  return (await res.json()) as T;
}

function curieToXref(curie: string, label?: string): TraitXref | null {
  // "MONDO:0001234" → { onto: "MONDO", id: "0001234" }
  const m = curie.match(/^([A-Za-z][A-Za-z0-9]*):(.+)$/);
  if (!m) return null;
  const xref: TraitXref = {
    onto: m[1]!.toUpperCase(),
    id: m[2]!,
  };
  if (label) xref.label = label;
  return xref;
}

/** Fetch cross-references for one ontology term. `id` accepts either
 *  "EFO_0004713" or "EFO:0004713" — internally normalized to colon
 *  form (what OXO expects). Returns an empty list on any error
 *  (network, rate limit, unknown ID) so callers can degrade gracefully. */
export async function fetchMappings(
  id: string,
  options: { distance?: number } = {},
): Promise<TraitXref[]> {
  const curie = id.replace("_", ":");
  if (!curie.includes(":")) return [];
  const distance = options.distance ?? 2;
  const cacheKey = `${curie}|${distance}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url =
    `${OXO_BASE}/mappings?` +
    new URLSearchParams({
      fromId: curie,
      distance: String(distance),
      size: "100",
    }).toString();
  let data: OxoMappingsResponse;
  try {
    data = await fetchJson<OxoMappingsResponse>(url);
  } catch {
    return [];
  }

  const seen = new Set<string>([curie]); // skip self-mappings
  const out: TraitXref[] = [];
  for (const m of data._embedded?.mappings ?? []) {
    const toCurie = m.toTerm?.curie;
    if (!toCurie || seen.has(toCurie)) continue;
    seen.add(toCurie);
    const xref = curieToXref(toCurie, m.toTerm?.label);
    if (xref) out.push(xref);
  }
  cache.set(cacheKey, out);
  return out;
}
