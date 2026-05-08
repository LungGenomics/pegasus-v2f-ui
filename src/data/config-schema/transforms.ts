// Per-transform-type parameter schemas. Used by the schema-driven transform
// editor to render the right form for whatever type the user picked.
//
// Mirrors the 14 transforms compiled by src/data/transform/compile.ts.
// Adding a new transform type means: add a compiler in compile.ts AND add
// a param schema here.

import type { EntitySchema } from "../../components/schema-form/types";

const AGG_FUNCTIONS = [
  { value: "min", label: "min" },
  { value: "max", label: "max" },
  { value: "sum", label: "sum" },
  { value: "avg", label: "avg" },
  { value: "count", label: "count" },
  { value: "first", label: "first" },
  { value: "last", label: "last" },
  { value: "string_agg", label: "string_agg" },
  { value: "array_agg", label: "array_agg" },
];

export const transformSchemas: Record<string, EntitySchema> = {
  rename: {
    columns: {
      type: "mapping",
      label: "Column renames",
      description: "Map old column names to new ones.",
      keyLabel: "old name",
      valueLabel: "new name",
      required: true,
    },
  },

  select: {
    columns: {
      type: "list",
      label: "Columns to keep",
      description: "Comma-separated list of columns to keep.",
      required: true,
    },
  },

  deduplicate: {
    columns: {
      type: "list",
      label: "Columns (optional)",
      description:
        "Drop rows where these columns are identical. Leave blank to deduplicate by all columns.",
    },
  },

  strip_prefix: {
    column: {
      type: "string",
      label: "Column",
      required: true,
    },
    prefix: {
      type: "string",
      label: "Prefix to strip",
      required: true,
      placeholder: "e.g., chr",
    },
  },

  uppercase: {
    column: {
      type: "string",
      label: "Column",
      required: true,
    },
  },

  drop_nulls: {
    columns: {
      type: "list",
      label: "Columns",
      description: "Drop rows where any of these columns is NULL.",
      required: true,
    },
  },

  coerce_numeric: {
    columns: {
      type: "list",
      label: "Columns",
      description:
        "Convert these columns to numeric. Values that don't parse become NULL.",
      required: true,
    },
  },

  filter_values: {
    column: {
      type: "string",
      label: "Column",
      required: true,
    },
    values: {
      type: "list",
      label: "Keep values",
      description: "Keep rows where the column matches one of these values.",
      required: true,
    },
  },

  parse_variant_id: {
    column: {
      type: "string",
      label: "Variant ID column",
      description:
        'Parses formats like "chr1:16979534C:A" into chromosome + position columns.',
      required: true,
    },
  },

  split_column: {
    column: {
      type: "string",
      label: "Source column",
      required: true,
    },
    delimiter: {
      type: "string",
      label: "Delimiter",
      default: ",",
      required: true,
    },
    columns: {
      type: "list",
      label: "Output columns",
      description:
        "Names for the resulting split columns, in order.",
      required: true,
    },
  },

  aggregate: {
    group_by: {
      type: "list",
      label: "Group by",
      description: "Columns to group rows by.",
      required: true,
    },
    agg: {
      type: "mapping",
      label: "Aggregations",
      description:
        "For each column, pick the aggregation function applied within each group.",
      keyLabel: "column",
      valueOptions: AGG_FUNCTIONS,
      required: true,
    },
  },

  compute: {
    output: {
      type: "string",
      label: "Output column",
      required: true,
    },
    expression: {
      type: "string",
      label: "Expression",
      description:
        'SQL expression over the existing columns, e.g. "(start + end) / 2".',
      required: true,
    },
  },

  map_gene_id: {
    column: {
      type: "string",
      label: "Gene ID column",
      required: true,
    },
    from: {
      type: "enum",
      label: "From",
      options: [{ value: "ensembl", label: "Ensembl" }],
      default: "ensembl",
      required: true,
    },
    to: {
      type: "enum",
      label: "To",
      options: [{ value: "hgnc", label: "HGNC symbol" }],
      default: "hgnc",
      required: true,
    },
    drop_unmapped: {
      type: "boolean",
      label: "Drop unmapped rows",
      default: false,
    },
  },

  custom: {
    custom_function: {
      type: "enum",
      label: "Custom function",
      options: [
        { value: "parse_evidence", label: "parse_evidence" },
        { value: "apply_f_trait", label: "apply_f_trait" },
      ],
      required: true,
    },
  },
};

/** Display metadata for the transform-type picker. */
export const transformTypeMeta: Array<{
  value: string;
  label: string;
  description: string;
}> = [
  { value: "rename", label: "Rename", description: "Rename columns" },
  { value: "select", label: "Select", description: "Keep specific columns" },
  { value: "deduplicate", label: "Deduplicate", description: "Drop duplicate rows" },
  { value: "strip_prefix", label: "Strip prefix", description: "Remove prefix from values" },
  { value: "uppercase", label: "Uppercase", description: "Uppercase column values" },
  { value: "drop_nulls", label: "Drop nulls", description: "Drop rows with NULL in given columns" },
  { value: "coerce_numeric", label: "Coerce numeric", description: "String → number, NULL on bad" },
  { value: "filter_values", label: "Filter values", description: "Keep rows matching values" },
  { value: "parse_variant_id", label: "Parse variant ID", description: "Split chr1:123:A:T into chr+pos" },
  { value: "split_column", label: "Split column", description: "Split string into multiple columns" },
  { value: "aggregate", label: "Aggregate", description: "Group by + aggregate" },
  { value: "compute", label: "Compute", description: "Derived column from arithmetic" },
  { value: "map_gene_id", label: "Map gene ID", description: "Ensembl → HGNC" },
  { value: "custom", label: "Custom", description: "Named function (parse_evidence, apply_f_trait)" },
];
