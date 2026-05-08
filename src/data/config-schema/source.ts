// Schema-as-code metadata for source_configs entities. The SchemaForm
// component renders a form from this; adding a column to the
// config.source_configs table is two steps: a migration adding the column,
// and a new entry here.

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
  data_type: {
    type: "string",
    label: "Data type / category",
    description: "Optional tag used in the source list filter.",
    placeholder: "e.g. PHEWAS, eQTL, FUNC",
  },
  gene_column: {
    type: "string",
    label: "Gene column",
    description:
      "Column in the raw data that holds the gene symbol (used as a fallback when no evidence_block specifies one).",
  },
  include_in_search: {
    type: "boolean",
    label: "Include in gene search",
    description:
      "Whether genes from this source contribute to the global gene_search_index.",
    default: true,
  },
};
