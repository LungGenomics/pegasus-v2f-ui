// Schema-as-code metadata for config.sources. Drives the source detail
// editor (Phase 4) and the Add Data wizard's step 1.
//
// Adding a column to config.sources is two steps: a migration adding
// the column, and a new entry here.

import type { EntitySchema, FormState } from "../../components/schema-form/types";

const SOURCE_TYPES = [
  { value: "googlesheets", label: "Google Sheets" },
  { value: "csv", label: "CSV file" },
  { value: "tsv", label: "TSV file" },
  { value: "parquet", label: "Parquet file" },
  { value: "url", label: "HTTPS URL" },
];

const NEEDS_URL = new Set(["googlesheets", "csv", "tsv", "parquet", "url"]);

export const sourceConfigSchema: EntitySchema = {
  name: {
    type: "string",
    label: "Name",
    description:
      "Internal identifier — appears in raw table names and source tags. Lowercase, digits, underscores only.",
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
    description: "Human-friendly label shown in the UI.",
    placeholder: "e.g. Shrine 2023 PHEWAS",
  },
  source_type: {
    type: "enum",
    label: "Source type",
    description: "How the data is delivered.",
    required: true,
    options: SOURCE_TYPES,
  },
  url: {
    type: "string",
    label: "URL",
    description:
      "HTTPS URL to the data file. For Google Sheets, the standard /edit URL works — we extract the spreadsheet ID and fetch as CSV.",
    placeholder: "https://…",
    showWhen: (s: FormState) =>
      typeof s.source_type === "string" && NEEDS_URL.has(s.source_type),
  },
  sheet: {
    type: "string",
    label: "Sheet name",
    description: "Tab name in the Google Sheet (omit to use the first tab).",
    showWhen: (s: FormState) => s.source_type === "googlesheets",
  },
  skip_rows: {
    type: "int",
    label: "Skip rows",
    description: "Header / banner rows to skip before parsing.",
    default: 0,
    min: 0,
  },
  description: {
    type: "text",
    label: "Description",
    description: "Free-form notes on this source.",
    rows: 2,
  },
};

const ANCESTRY_OPTIONS = [
  { value: "EUR", label: "European" },
  { value: "AFR", label: "African" },
  { value: "EAS", label: "East Asian" },
  { value: "SAS", label: "South Asian" },
  { value: "AMR", label: "Admixed American" },
  { value: "MIXED", label: "Mixed / multi-ancestry" },
  { value: "OTHER", label: "Other" },
];

/** Citation metadata schema — populated for sources whose derivations
 *  include a `role=loci_definition`. 1:1 with config.source_citation. */
export const sourceCitationSchema: EntitySchema = {
  gwas_source: {
    type: "string",
    label: "GWAS source",
    description: "Citation string (e.g. 'Shrine et al. 2023').",
    placeholder: "Shrine et al. 2023",
  },
  ancestry: {
    type: "enum",
    label: "Ancestry",
    options: [{ value: "", label: "—" }, ...ANCESTRY_OPTIONS],
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
  pubmed_id: {
    type: "string",
    label: "PubMed ID",
  },
};
