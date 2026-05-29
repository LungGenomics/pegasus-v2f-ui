// Orchestrator for the derived data layer (plan 2026-05-28).
// Full rebuild, in dependency order:
//   1. main.evidence        (view)   — UNION of mapping projections
//   2. main.gene_reference  (table)  — loaded once from R2 parquet (cached)
//   3. main.loci            (table)  — window+merge over evidence variants
//   4. main.loci.n_candidate_genes + main.locus_evidence (view)
//
// evidence + locus_evidence are cheap views; loci is the one materialized
// computation. The gene reference is a built-in parquet (geneReference.ts),
// fetched once and cached — biotype changes never refetch (see refreshLoci-
// EvidenceForBiotypes).

import { getDataSource } from "../select";
import { buildEvidenceView, ensureColumnScopeTraits } from "./evidence";
import { buildLoci, type BuildLociResult } from "./loci";
import { ensureGeneReference } from "./geneReference";
import { buildLocusEvidenceView } from "./locusEvidence";

export interface RebuildDerivedResult {
  loci: BuildLociResult[];
  geneReferenceRows: number;
  /** Diagnostics — make the chromosome-alignment / empty-join failures
   *  visible instead of silent. */
  evidenceRows: number;
  locusEvidenceRows: number;
  lociWithCandidates: number;
  totalLoci: number;
}

async function count(sql: string): Promise<number> {
  const ds = getDataSource();
  const [row] = await ds.query<{ n: number }>({ sql });
  return Number(row?.n ?? 0);
}

export async function rebuildDerived(
  actor: string | null = null,
): Promise<RebuildDerivedResult> {
  // 0. Register traits referenced by column-scope mappings so the evidence
  //    view's label→trait_id join resolves (else trait_id is all NULL).
  //    Auto-derived traits are attributed to the rebuild's actor.
  await ensureColumnScopeTraits(actor);
  // 1. evidence view (depends only on mappings/transforms).
  await buildEvidenceView();
  // 2. gene reference — full parquet, cached (no refetch if already loaded).
  const geneReferenceRows = await ensureGeneReference();
  // 3. loci (each loci mapping's own projected variants).
  const loci = await buildLoci();
  // 4. locus_evidence view + loci.n_candidate_genes (reads evidence + loci +
  //    gene_reference).
  await buildLocusEvidenceView();

  const [evidenceRows, locusEvidenceRows, lociWithCandidates, totalLoci] =
    await Promise.all([
      count("SELECT COUNT(*) AS n FROM main.evidence"),
      count("SELECT COUNT(*) AS n FROM main.locus_evidence"),
      count("SELECT COUNT(*) AS n FROM main.loci WHERE n_candidate_genes > 0"),
      count("SELECT COUNT(*) AS n FROM main.loci"),
    ]);

  return {
    loci,
    geneReferenceRows,
    evidenceRows,
    locusEvidenceRows,
    lociWithCandidates,
    totalLoci,
  };
}

/** Cheap path for a biotype-only change: rebuild just the locus_evidence view
 *  (+ n_candidate_genes). No parquet refetch, no evidence/loci rebuild — the
 *  candidate-gene biotype filter lives entirely in the view. */
export async function refreshLociEvidenceForBiotypes(): Promise<void> {
  // The gene reference must be present; if a biotype change is even possible
  // the user has already loaded it, but ensure it cheaply (no-ops if loaded).
  await ensureGeneReference();
  await buildLocusEvidenceView();
}
