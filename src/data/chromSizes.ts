// Chromosome sizes — fetched from the seqcol API directly from the browser.
// Cached per genome build in localStorage to avoid re-fetching.

import type { ChromSizes } from "../api/types";

const SEQCOL_API = "https://seqcolapi.databio.org";
const SEQCOL_DIGESTS: Record<string, string> = {
  hg38: "NTeQ1GQMt2ocCFkS8Z3_qkvetZjabWSt",
  GRCh38: "NTeQ1GQMt2ocCFkS8Z3_qkvetZjabWSt",
};
const STANDARD_CHROMS = [
  ...Array.from({ length: 22 }, (_, i) => `chr${i + 1}`),
  "chrX",
  "chrY",
];
const CACHE_KEY_PREFIX = "pegasus-v2f.chromSizes.";

export async function fetchChromSizes(genomeBuild: string): Promise<ChromSizes> {
  const cacheKey = CACHE_KEY_PREFIX + genomeBuild;
  if (typeof localStorage !== "undefined") {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ChromSizes;
      } catch {
        /* fall through and re-fetch */
      }
    }
  }

  const digest = SEQCOL_DIGESTS[genomeBuild];
  if (!digest) {
    throw new Error(`No seqcol digest known for genome build '${genomeBuild}'`);
  }

  const resp = await fetch(`${SEQCOL_API}/collection/${digest}?level=2`);
  if (!resp.ok) throw new Error(`seqcol fetch failed: ${resp.status}`);
  const data = (await resp.json()) as { names: string[]; lengths: number[] };

  const lookup = new Map<string, number>();
  data.names.forEach((n, i) => lookup.set(n, data.lengths[i]!));

  const names: string[] = [];
  const lengths: number[] = [];
  for (const chrom of STANDARD_CHROMS) {
    const len = lookup.get(chrom);
    if (len != null) {
      names.push(chrom);
      lengths.push(len);
    }
  }

  const result: ChromSizes = { names, lengths };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(cacheKey, JSON.stringify(result));
  }
  return result;
}
