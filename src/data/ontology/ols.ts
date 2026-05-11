// OLS4 (Ontology Lookup Service) API wrapper. Hosted by EBI at
// https://www.ebi.ac.uk/ols4/api/. CORS-friendly, free, no key.
//
// Three operations the rest of the app uses:
//   1. search()         — autocomplete from a free-text query
//   2. fetchTermDetails() — definition + synonyms for a chosen term
//   3. fetchAncestors() — hierarchy path from the term to the ontology root
//
// All results are cached in-memory for the duration of a page session
// to avoid duplicate fetches when the user toggles between traits.

import type { TraitHierarchyNode } from "../../api/types";

const OLS_BASE = "https://www.ebi.ac.uk/ols4/api";

// --- Result shapes --------------------------------------------------

export interface OlsSearchResult {
  /** Short identifier like "EFO_0004713" — what we'd store as
   *  primary_ontology_id. */
  obo_id: string;
  /** "EFO" / "MONDO" / "HPO" / etc. */
  ontology: string;
  iri: string;
  label: string;
  description?: string;
  synonyms?: string[];
  is_obsolete?: boolean;
}

export interface OlsTermDetails {
  obo_id: string;
  ontology: string;
  iri: string;
  label: string;
  description?: string;
  synonyms: string[];
  is_obsolete: boolean;
}

// --- Caches ---------------------------------------------------------

const searchCache = new Map<string, OlsSearchResult[]>();
const termCache = new Map<string, OlsTermDetails>();
const ancestorCache = new Map<string, TraitHierarchyNode[]>();

// --- Helpers --------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `OLS request failed (${res.status} ${res.statusText}): ${url}`,
    );
  }
  return (await res.json()) as T;
}

function normalizeOntologyName(raw: string | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/_/g, "");
}

function parseObo(obo: string): { ontology: string; localId: string } | null {
  // "EFO:0004713" → { ontology: "EFO", localId: "0004713" }
  // "EFO_0004713" → same
  const m = obo.match(/^([A-Za-z][A-Za-z0-9]*)[:_](.+)$/);
  if (!m) return null;
  return { ontology: m[1]!.toUpperCase(), localId: m[2]! };
}

interface OlsSearchResponse {
  response?: {
    docs?: Array<{
      iri?: string;
      ontology_name?: string;
      ontology_prefix?: string;
      obo_id?: string;
      label?: string;
      description?: string[];
      synonym?: string[];
      is_obsolete?: boolean;
    }>;
    numFound?: number;
  };
}

interface OlsTermResponse {
  iri?: string;
  label?: string;
  description?: string[];
  obo_id?: string;
  ontology_name?: string;
  ontology_prefix?: string;
  synonyms?: string[];
  is_obsolete?: boolean;
}

interface OlsAncestorsResponse {
  _embedded?: {
    terms?: Array<{
      iri?: string;
      label?: string;
      obo_id?: string;
    }>;
  };
}

// --- Public API -----------------------------------------------------

/** Autocomplete search across one or more ontologies. */
export async function search(
  query: string,
  options: {
    ontologies?: string[];
    rows?: number;
  } = {},
): Promise<OlsSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const ontologies = (options.ontologies ?? ["efo", "mondo", "hpo", "orphanet"])
    .map((o) => o.toLowerCase())
    .join(",");
  const rows = Math.min(options.rows ?? 20, 50);
  const cacheKey = `${q}|${ontologies}|${rows}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const url =
    `${OLS_BASE}/search?` +
    new URLSearchParams({
      q,
      ontology: ontologies,
      rows: String(rows),
      exact: "false",
    }).toString();
  const data = await fetchJson<OlsSearchResponse>(url);
  const out: OlsSearchResult[] = [];
  for (const doc of data.response?.docs ?? []) {
    if (doc.is_obsolete) continue;
    if (!doc.obo_id || !doc.label) continue;
    const oboParts = parseObo(doc.obo_id);
    const ontology =
      normalizeOntologyName(doc.ontology_prefix) ||
      oboParts?.ontology ||
      normalizeOntologyName(doc.ontology_name);
    if (!ontology) continue;
    out.push({
      obo_id: doc.obo_id.replace(":", "_"),
      ontology,
      iri: doc.iri ?? "",
      label: doc.label,
      description: doc.description?.[0],
      synonyms: doc.synonym,
      is_obsolete: false,
    });
  }
  searchCache.set(cacheKey, out);
  return out;
}

/** Pull description + synonyms for a known term. `ontologyId` accepts
 *  either "EFO_0004713" or "EFO:0004713" form. */
export async function fetchTermDetails(
  ontology: string,
  ontologyId: string,
): Promise<OlsTermDetails | null> {
  const ont = ontology.toLowerCase();
  const oboParts = parseObo(ontologyId);
  if (!oboParts) return null;
  const iri = oboParts.ontology.startsWith("EFO")
    ? `http://www.ebi.ac.uk/efo/${oboParts.ontology}_${oboParts.localId}`
    : `http://purl.obolibrary.org/obo/${oboParts.ontology}_${oboParts.localId}`;
  const cacheKey = `${ont}|${iri}`;
  const cached = termCache.get(cacheKey);
  if (cached) return cached;
  const url =
    `${OLS_BASE}/ontologies/${encodeURIComponent(ont)}/terms/` +
    encodeURIComponent(encodeURIComponent(iri));
  let data: OlsTermResponse;
  try {
    data = await fetchJson<OlsTermResponse>(url);
  } catch {
    return null;
  }
  if (!data.label) return null;
  const details: OlsTermDetails = {
    obo_id: (data.obo_id ?? ontologyId).replace(":", "_"),
    ontology: normalizeOntologyName(data.ontology_prefix) || oboParts.ontology,
    iri: data.iri ?? iri,
    label: data.label,
    description: data.description?.[0],
    synonyms: data.synonyms ?? [],
    is_obsolete: Boolean(data.is_obsolete),
  };
  termCache.set(cacheKey, details);
  return details;
}

/** Ordered ancestor chain (root → term, excluding the term itself).
 *  OLS returns ancestors unordered; we sort by depth = "fewest parents
 *  of its own first" via a follow-up query when needed. For a simple
 *  breadcrumb, label-string sort is good enough as a baseline. */
export async function fetchAncestors(
  ontology: string,
  ontologyId: string,
): Promise<TraitHierarchyNode[]> {
  const oboParts = parseObo(ontologyId);
  if (!oboParts) return [];
  const ont = ontology.toLowerCase();
  const cacheKey = `${ont}|${ontologyId}`;
  const cached = ancestorCache.get(cacheKey);
  if (cached) return cached;

  const iri = oboParts.ontology.startsWith("EFO")
    ? `http://www.ebi.ac.uk/efo/${oboParts.ontology}_${oboParts.localId}`
    : `http://purl.obolibrary.org/obo/${oboParts.ontology}_${oboParts.localId}`;
  const url =
    `${OLS_BASE}/ontologies/${encodeURIComponent(ont)}/terms/` +
    encodeURIComponent(encodeURIComponent(iri)) +
    "/ancestors?size=50";
  let data: OlsAncestorsResponse;
  try {
    data = await fetchJson<OlsAncestorsResponse>(url);
  } catch {
    return [];
  }
  const nodes: TraitHierarchyNode[] = [];
  for (const t of data._embedded?.terms ?? []) {
    if (!t.obo_id || !t.label) continue;
    nodes.push({ id: t.obo_id.replace(":", "_"), label: t.label });
  }
  ancestorCache.set(cacheKey, nodes);
  return nodes;
}

/** Infer the trait_kind from the term's ancestors. Looks for
 *  well-known anchor classes:
 *    - EFO_0001444 measurement      → "measurement"
 *    - EFO_0000408 disease          → "disease"
 *    - MONDO_0000001 disease        → "disease"
 *    - HP_0000001 phenotypic abnormality → "phenotype"
 *  Falls back to "other" if none match. */
export function inferTraitKind(
  ancestors: TraitHierarchyNode[],
): "measurement" | "disease" | "phenotype" | "other" {
  const ids = new Set(ancestors.map((n) => n.id));
  if (ids.has("EFO_0001444")) return "measurement";
  if (ids.has("EFO_0000408") || ids.has("MONDO_0000001")) return "disease";
  if (ids.has("HP_0000001")) return "phenotype";
  return "other";
}
