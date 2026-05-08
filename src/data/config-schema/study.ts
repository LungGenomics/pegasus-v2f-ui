import type { EntitySchema } from "../../components/schema-form/types";

export const studyConfigSchema: EntitySchema = {
  id_prefix: {
    type: "string",
    label: "Study ID prefix",
    description:
      "Used to derive study_id values for loci/scored_evidence rows from this study.",
    required: true,
    validators: [
      {
        type: "regex",
        pattern: "^[a-z][a-z0-9_]*$",
        message: "Lowercase letters, digits, and underscores only",
      },
    ],
  },
  display_name: {
    type: "string",
    label: "Display name",
    placeholder: "e.g. Shrine 2023",
  },
  traits: {
    type: "list",
    label: "Traits",
    description:
      "One or more trait labels covered by this study (e.g. FEV1, FVC).",
    required: true,
  },
  description: {
    type: "text",
    label: "Description",
    rows: 2,
  },
  gwas_source: {
    type: "string",
    label: "GWAS source",
    description: "Citation for the underlying GWAS (e.g. 'Shrine et al. 2023').",
  },
  ancestry: {
    type: "enum",
    label: "Ancestry",
    options: [
      { value: "EUR", label: "European" },
      { value: "AFR", label: "African" },
      { value: "EAS", label: "East Asian" },
      { value: "SAS", label: "South Asian" },
      { value: "AMR", label: "Admixed American" },
      { value: "MIXED", label: "Mixed / multi-ancestry" },
      { value: "OTHER", label: "Other" },
    ],
  },
  sample_size: {
    type: "int",
    label: "Sample size",
    min: 0,
  },
  doi: {
    type: "string",
    label: "DOI",
    placeholder: "10.1038/…",
  },
  year: {
    type: "int",
    label: "Year",
    min: 1900,
    max: 2100,
  },
  loci_source: {
    type: "string",
    label: "Loci source",
    description: "Source name (must exist in source_configs) that supplies the loci for this study.",
  },
  loci_sheet: {
    type: "string",
    label: "Loci sheet name",
    description: "Sheet within the loci source (Google Sheets only).",
  },
  loci_skip: {
    type: "int",
    label: "Loci skip rows",
    default: 0,
    min: 0,
  },
  gene_column: {
    type: "string",
    label: "Gene column (loci source)",
    description: "Column name holding the candidate/effector gene in the loci source.",
  },
  sentinel_column: {
    type: "string",
    label: "Sentinel variant column",
    description: "Column name holding the lead variant ID in the loci source.",
  },
  pvalue_column: {
    type: "string",
    label: "P-value column",
  },
  rsid_column: {
    type: "string",
    label: "rsID column",
  },
};
