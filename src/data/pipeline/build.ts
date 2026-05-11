// Build orchestrator for one source. Runs:
//   1. Raw load — fetch the file, write main.raw_<source_id>
//   2. For each derivation on the source, route into main.evidence
//   3. For each loci_definition derivation, run loci derivation
//
// Scoring (materialize.ts) is a separate top-level call — runs once
// after all sources are built, not per-source.

import { getSource } from "../sourceOps";
import { listDerivationsForSource } from "../derivationOps";
import { loadRawSource, type LoadResult } from "./load";
import { routeDerivation, type RouteResult } from "./route";
import { deriveLoci, type DeriveLociResult } from "./loci";

export interface BuildSourceResult {
  source_id: string;
  source_name: string;
  raw: LoadResult;
  derivations: RouteResult[];
  loci: DeriveLociResult[];
}

/** Build one source by name: load raw, route every derivation, derive
 *  loci for any loci-definition derivations. */
export async function buildSource(name: string): Promise<BuildSourceResult> {
  const source = await getSource(name);
  if (!source) {
    throw new Error(
      `Source '${name}' not found in config.sources — add it via the wizard first.`,
    );
  }

  // 1. Raw load
  const raw = await loadRawSource(source);

  // 2. Per-derivation routing into main.evidence
  const derivations = await listDerivationsForSource(source.id);
  const routeResults: RouteResult[] = [];
  for (const d of derivations) {
    const r = await routeDerivation(source, d);
    routeResults.push(r);
  }

  // 3. Loci derivation for each loci-definition derivation. Done after
  //    routing so the locus-building reads from the now-populated
  //    main.evidence rows tagged with this derivation's source_tag.
  const lociResults: DeriveLociResult[] = [];
  for (const d of derivations) {
    if (d.role !== "loci_definition") continue;
    const r = await deriveLoci(source, d);
    lociResults.push(r);
  }

  return {
    source_id: source.id,
    source_name: source.name,
    raw,
    derivations: routeResults,
    loci: lociResults,
  };
}

/** Build every source in config.sources. Useful for "rebuild all" after
 *  a fresh DB load. Returns results per source. */
export async function buildAllSources(): Promise<BuildSourceResult[]> {
  const { listSources } = await import("../sourceOps");
  const sources = await listSources();
  const results: BuildSourceResult[] = [];
  for (const s of sources) {
    results.push(await buildSource(s.name));
  }
  return results;
}
