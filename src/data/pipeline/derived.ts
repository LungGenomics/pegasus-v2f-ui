// Orchestrator for the derived data layer (plan 2026-05-28).
// Rebuilds, in dependency order:
//   1. main.evidence        (view)   — UNION of mapping projections
//   2. main.gene_reference  (table)  — loaded once per session from R2 parquet
//   3. main.loci            (table)  — window+merge over evidence variants
//   4. main.loci.n_candidate_genes + main.locus_evidence (view)
//
// evidence + locus_evidence are cheap views; loci is the one materialized
// computation. The gene reference is optional: without a configured URL we
// still build evidence + loci, but skip locus_evidence (it needs candidate
// genes from the reference) and surface that in the result.

import { buildEvidenceView } from "./evidence";
import { buildLoci, type BuildLociResult } from "./loci";
import { ensureGeneReference, getGeneReferenceUrl } from "./geneReference";
import { buildLocusEvidenceView } from "./locusEvidence";

export interface RebuildDerivedResult {
  loci: BuildLociResult[];
  geneReferenceRows: number | null;
  /** Set when locus_evidence was skipped (no gene reference configured). */
  skipped?: string;
}

export async function rebuildDerived(): Promise<RebuildDerivedResult> {
  // 1. evidence view (no dependencies beyond mappings/transforms).
  await buildEvidenceView();

  // 2. gene reference — optional. If unset, build loci but skip
  //    locus_evidence (candidate genes need the reference).
  const url = await getGeneReferenceUrl();
  let geneReferenceRows: number | null = null;
  if (url) {
    geneReferenceRows = await ensureGeneReference();
  }

  // 3. loci (reads main.evidence).
  const loci = await buildLoci();

  // 4. locus_evidence (reads evidence + loci + gene_reference).
  if (!url) {
    return {
      loci,
      geneReferenceRows,
      skipped:
        "locus_evidence skipped — set config.pegasus_settings.gene_reference_url " +
        "and rebuild to compute candidate genes.",
    };
  }
  await buildLocusEvidenceView();
  return { loci, geneReferenceRows };
}
