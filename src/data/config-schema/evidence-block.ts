// Schema for a single evidence block on a source. Mirrors the V2fEvidenceBlock
// shape — the inner `fields` mapping uses column-ref values populated from
// the upstream stage's preview when wrapped in a SchemaFormProvider.

import type { EntitySchema } from "../../components/schema-form/types";
import { EVIDENCE_CATEGORIES } from "../static";

const CATEGORY_OPTIONS = Object.entries(EVIDENCE_CATEGORIES).map(
  ([abbrev, label]) => ({
    value: abbrev,
    label: `${abbrev} — ${label}`,
  }),
);

export const evidenceBlockSchema: EntitySchema = {
  source_tag: {
    type: "string",
    label: "Source tag",
    description:
      "Stable identifier — appears as source_tag on every evidence row from this block.",
    required: true,
    validators: [
      {
        type: "regex",
        pattern: "^[a-z][a-z0-9_]*$",
        message: "Lowercase letters, digits, and underscores only",
      },
    ],
  },
  category: {
    type: "enum",
    label: "Category",
    description: "PEGASUS evidence category. Determines how rows are scored.",
    options: CATEGORY_OPTIONS,
    required: true,
  },
  centric: {
    type: "enum",
    label: "Centric",
    description:
      "Whether each row of this source describes a variant (chr/pos) or a gene.",
    options: [
      { value: "variant", label: "variant" },
      { value: "gene", label: "gene" },
    ],
    default: "gene",
    required: true,
  },
  role: {
    type: "string",
    label: "Role (optional)",
    description:
      'Set to "locus_definition" if this block is the source of loci for a study.',
  },
  traits: {
    type: "list",
    label: "Traits (constant)",
    description:
      "Apply these trait labels to every row. Leave empty if the data has a per-row trait column (map it via fields below instead).",
  },
  fields: {
    type: "mapping",
    label: "Field mappings",
    description:
      "Map evidence-table columns (gene_symbol, chromosome, pvalue, …) to columns in this source's transformed data.",
    keyLabel: "evidence column",
    valueAsColumnRef: true,
    required: true,
  },
};
