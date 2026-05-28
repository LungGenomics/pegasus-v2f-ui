// Per-transform-type parameter schemas. Used by the schema-driven transform
// editor to render the right form for whatever type the user picked.
//
// Mirrors the 14 transforms compiled by src/data/transform/compile.ts.
// Adding a new transform type means: add a compiler in compile.ts AND add
// a param schema here.
//
// "column-ref" / "column-ref-list" fields render as selects populated from
// the upstream stage's preview when a SchemaFormProvider supplies columns.

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
      keyAsColumnRef: true,
      required: true,
    },
  },

  select: {
    columns: {
      type: "column-ref-list",
      label: "Columns to keep",
      required: true,
    },
  },

  deduplicate: {
    columns: {
      type: "column-ref-list",
      label: "Columns (optional)",
      description:
        "Drop rows where these columns are identical. Leave blank to deduplicate by all columns.",
    },
  },

  strip_prefix: {
    column: {
      type: "column-ref",
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

  add_prefix: {
    column: {
      type: "column-ref",
      label: "Column",
      required: true,
    },
    prefix: {
      type: "string",
      label: "Prefix to add",
      required: true,
      placeholder: "e.g., chr",
    },
  },

  uppercase: {
    column: {
      type: "column-ref",
      label: "Column",
      required: true,
    },
  },

  drop_nulls: {
    columns: {
      type: "column-ref-list",
      label: "Columns",
      description: "Drop rows where any of these columns is NULL.",
      required: true,
    },
  },

  coerce_numeric: {
    columns: {
      type: "column-ref-list",
      label: "Columns",
      description:
        "Convert these columns to numeric. Values that don't parse become NULL.",
      required: true,
    },
  },

  filter_values: {
    column: {
      type: "column-ref",
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
      type: "column-ref",
      label: "Variant ID column",
      description:
        'Parses formats like "chr1:16979534C:A" into chromosome + position columns.',
      required: true,
    },
  },

  split_column: {
    column: {
      type: "column-ref",
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
      description: "Names for the resulting split columns, in order.",
      required: true,
    },
  },

  explode_column: {
    column: {
      type: "column-ref",
      label: "Column to explode",
      description:
        "Each row with a delimiter-separated value in this column becomes multiple rows, one per split value. Useful for aggregated sheets where a single row lists several traits (or tissues, etc.).",
      required: true,
    },
    delimiter: {
      type: "string",
      label: "Delimiter",
      default: ",",
      required: true,
    },
    trim: {
      type: "boolean",
      label: "Trim whitespace",
      description:
        "Strip leading/trailing whitespace from each split value (recommended).",
      default: true,
    },
  },

  aggregate: {
    group_by: {
      type: "column-ref-list",
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
      keyAsColumnRef: true,
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
      type: "column-ref",
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
  { value: "add_prefix", label: "Add prefix", description: "Prepend a prefix to values (e.g. chr)" },
  { value: "uppercase", label: "Uppercase", description: "Uppercase column values" },
  { value: "drop_nulls", label: "Drop nulls", description: "Drop rows with NULL in given columns" },
  { value: "coerce_numeric", label: "Coerce numeric", description: "String → number, NULL on bad" },
  { value: "filter_values", label: "Filter values", description: "Keep rows matching values" },
  { value: "parse_variant_id", label: "Parse variant ID", description: "Split chr1:123:A:T into chr+pos" },
  { value: "split_column", label: "Split column", description: "Split string into multiple columns" },
  { value: "explode_column", label: "Explode column", description: "One row per delimiter-separated value (changes row count)" },
  { value: "aggregate", label: "Aggregate", description: "Group by + aggregate" },
  { value: "compute", label: "Compute", description: "Derived column from arithmetic" },
  { value: "map_gene_id", label: "Map gene ID", description: "Ensembl → HGNC" },
  { value: "custom", label: "Custom", description: "Named function (parse_evidence, apply_f_trait)" },
];
