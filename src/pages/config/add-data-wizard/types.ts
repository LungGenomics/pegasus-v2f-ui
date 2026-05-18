// Shared types for the Add Data wizard. The orchestrator
// (`wizard.tsx`) holds one WizardState; each step component reads its
// slice via props and patches via onPatch.

import type {
  DerivationCentric,
  DerivationRole,
  DerivationTraitScope,
  SourceCitation,
  TransformConfigEntry,
} from "../../../api/types";

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;

  // --- Step 1: source metadata ---
  name: string;
  display_name: string;
  description: string;
  source_type: string;
  url: string;
  sheet: string;
  skip_rows: number;

  // Populated after step 1 "Next" — in-memory preview, no DB write yet.
  rawColumns: string[];
  rawPreviewRows: Record<string, unknown>[];
  rawRowCount: number;

  // --- Step 2: interpret ---
  evidence_category: string;
  role: DerivationRole;
  centric: DerivationCentric;
  trait_scope: DerivationTraitScope;
  /** When trait_scope === 'constant'. */
  trait_ids: string[];
  /** When trait_scope === 'column'. */
  trait_column: string;
  /** Optional citation metadata, populated when role === 'loci_definition'. */
  citation: Omit<SourceCitation, "source_id" | "updated_at"> | null;

  // --- Step 3: transforms ---
  /** Ordered transform pipeline applied to the raw table *before* the
   *  column mapping projection (matches pipeline/route.ts ordering). */
  transforms: TransformConfigEntry[];

  // --- Step 4: column mapping ---
  /** canonical_field → raw_column */
  mappings: Record<string, string>;
}

export const INITIAL_STATE: WizardState = {
  step: 1,
  name: "",
  display_name: "",
  description: "",
  source_type: "googlesheets",
  url: "",
  sheet: "",
  skip_rows: 0,
  rawColumns: [],
  rawPreviewRows: [],
  rawRowCount: 0,
  evidence_category: "GWAS",
  role: "evidence",
  centric: "variant",
  trait_scope: "constant",
  trait_ids: [],
  trait_column: "",
  citation: null,
  transforms: [],
  mappings: {},
};

/** Canonical evidence-table fields the mapping step lets the user
 *  assign. `gene_symbol` is required; the rest are optional and shown
 *  in a recommended order based on the centric type. */
export const CANONICAL_FIELDS = [
  "gene_symbol",
  "chromosome",
  "position",
  "rsid",
  "pvalue",
  "effect_size",
  "score",
  "tissue",
  "cell_type",
  "ancestry",
  "sex",
  "evidence_stream",
] as const;

export const REQUIRED_FIELDS = new Set<string>(["gene_symbol"]);
