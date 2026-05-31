// Per-transform-type parameter schemas. Used by the schema-driven transform
// editor to render the right form for whatever type the user picked.
//
// Mirrors the transforms compiled by src/data/transform/compile.ts. Adding a
// new transform type means: add a compiler in compile.ts, a param schema here,
// a transformTypeMeta entry (label/description/category), and the type to the
// picker allow-list (source-workarea TRANSFORM_TYPES).
//
// "column-ref" / "column-ref-list" fields render as selects populated from the
// upstream stage's preview when a SchemaFormProvider supplies columns.

import type { EntitySchema } from "../../components/schema-form/types";

const AGG_FUNCTIONS = [
  { value: "min", label: "min" },
  { value: "max", label: "max" },
  { value: "sum", label: "sum" },
  { value: "avg", label: "avg" },
  { value: "median", label: "median" },
  { value: "count", label: "count" },
  { value: "count_distinct", label: "count distinct" },
  { value: "first", label: "first" },
  { value: "last", label: "last" },
  { value: "string_agg", label: "string_agg" },
  { value: "array_agg", label: "array_agg" },
];

export const transformSchemas: Record<string, EntitySchema> = {
  // --- Columns ---
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
    mode: {
      type: "enum",
      label: "Mode",
      options: [
        { value: "keep", label: "Keep these columns" },
        { value: "drop", label: "Drop these columns" },
      ],
      default: "keep",
    },
    columns: {
      type: "column-ref-list",
      label: "Columns",
      required: true,
    },
  },

  concat_columns: {
    columns: {
      type: "column-ref-list",
      label: "Columns to combine",
      description: "Joined left-to-right; nulls are skipped.",
      required: true,
    },
    separator: {
      type: "string",
      label: "Separator",
      placeholder: "e.g. : or _",
      default: "",
    },
    output: {
      type: "string",
      label: "Output column",
      required: true,
    },
  },

  // --- Text ---
  format_text: {
    columns: {
      type: "column-ref-list",
      label: "Columns",
      required: true,
    },
    case: {
      type: "enum",
      label: "Case",
      options: [
        { value: "none", label: "Leave as-is" },
        { value: "upper", label: "UPPERCASE" },
        { value: "lower", label: "lowercase" },
      ],
      default: "none",
    },
    trim: {
      type: "boolean",
      label: "Trim whitespace",
      default: false,
    },
  },

  affix: {
    columns: {
      type: "column-ref-list",
      label: "Columns",
      required: true,
    },
    action: {
      type: "enum",
      label: "Action",
      options: [
        { value: "strip", label: "Strip" },
        { value: "add", label: "Add" },
      ],
      default: "strip",
    },
    side: {
      type: "enum",
      label: "Side",
      options: [
        { value: "prefix", label: "Prefix (start)" },
        { value: "suffix", label: "Suffix (end)" },
      ],
      default: "prefix",
    },
    text: {
      type: "string",
      label: "Text",
      placeholder: "e.g. chr",
      required: true,
    },
    case_insensitive: {
      type: "boolean",
      label: "Case-insensitive",
      default: false,
    },
    idempotent: {
      type: "boolean",
      label: "Skip if already present",
      description: "When adding, don't double up (e.g. avoid chrchr1).",
      default: true,
      showWhen: (s) => s.action === "add",
    },
  },

  find_replace: {
    column: { type: "column-ref", label: "Column", required: true },
    find: { type: "string", label: "Find", required: true },
    replace: { type: "string", label: "Replace with", default: "", placeholder: "(empty = delete)" },
    all: { type: "boolean", label: "Replace all occurrences", default: true },
    case_insensitive: { type: "boolean", label: "Case-insensitive", default: false },
    regex: {
      type: "boolean",
      label: "Match as a regular expression (advanced)",
      default: false,
    },
  },

  extract: {
    column: { type: "column-ref", label: "Column", required: true },
    into: { type: "string", label: "Into new column", required: true },
    mode: {
      type: "enum",
      label: "Extract",
      options: [
        { value: "before", label: "Before a delimiter" },
        { value: "after", label: "After a delimiter" },
        { value: "between", label: "Between two delimiters" },
        { value: "first_chars", label: "First N characters" },
        { value: "pattern", label: "By pattern (advanced)" },
      ],
      default: "before",
    },
    delimiter: {
      type: "string",
      label: "Delimiter",
      showWhen: (s) => s.mode === "before" || s.mode === "after",
    },
    start_delim: {
      type: "string",
      label: "Start delimiter",
      showWhen: (s) => s.mode === "between",
    },
    end_delim: {
      type: "string",
      label: "End delimiter",
      showWhen: (s) => s.mode === "between",
    },
    n: {
      type: "int",
      label: "Number of characters",
      min: 1,
      showWhen: (s) => s.mode === "first_chars",
    },
    pattern: {
      type: "string",
      label: "Pattern (regex)",
      showWhen: (s) => s.mode === "pattern",
    },
    group: {
      type: "int",
      label: "Capture group",
      default: 1,
      min: 0,
      showWhen: (s) => s.mode === "pattern",
    },
  },

  split_column: {
    column: { type: "column-ref", label: "Source column", required: true },
    delimiter: { type: "string", label: "Delimiter", default: ",", required: true },
    columns: {
      type: "list",
      label: "Output columns",
      description: "Names for the resulting split columns, in order.",
      required: true,
    },
    trim: { type: "boolean", label: "Trim each part", default: false },
  },

  // --- Values ---
  coerce_numeric: {
    columns: {
      type: "column-ref-list",
      label: "Columns",
      description: "Convert to numeric. Values that don't parse become NULL.",
      required: true,
    },
    integer: {
      type: "boolean",
      label: "Whole numbers (integer)",
      default: false,
    },
  },

  normalize_nulls: {
    columns: { type: "column-ref-list", label: "Columns", required: true },
    empty: { type: "boolean", label: "Treat empty strings as null", default: true },
    whitespace: {
      type: "boolean",
      label: "Treat whitespace-only as null",
      default: true,
    },
    sentinels: {
      type: "list",
      label: "Values to treat as null",
      default: ["NA", "N/A", "NaN", "None", "NULL", "."],
    },
    case_insensitive: { type: "boolean", label: "Case-insensitive", default: true },
  },

  replace_values: {
    column: { type: "column-ref", label: "Column", required: true },
    mapping: {
      type: "mapping",
      label: "Replacements",
      description: "Each matching value is replaced; others pass through.",
      keyLabel: "from",
      valueLabel: "to",
      required: true,
    },
    case_insensitive: { type: "boolean", label: "Case-insensitive", default: false },
  },

  drop_nulls: {
    columns: { type: "column-ref-list", label: "Columns", required: true },
    mode: {
      type: "enum",
      label: "Drop a row when",
      options: [
        { value: "any", label: "Any of these is null" },
        { value: "all", label: "All of these are null" },
      ],
      default: "any",
    },
  },

  filter: {
    column: { type: "column-ref", label: "Column", required: true },
    operator: {
      type: "enum",
      label: "Keep rows where the column…",
      options: [
        { value: "in", label: "is one of" },
        { value: "not_in", label: "is not one of" },
        { value: "eq", label: "= equals" },
        { value: "ne", label: "≠ does not equal" },
        { value: "lt", label: "< less than" },
        { value: "lte", label: "≤ at most" },
        { value: "gt", label: "> greater than" },
        { value: "gte", label: "≥ at least" },
        { value: "between", label: "is between" },
        { value: "contains", label: "contains" },
        { value: "not_contains", label: "does not contain" },
      ],
      default: "in",
    },
    values: {
      type: "list",
      label: "Values",
      showWhen: (s) => s.operator === "in" || s.operator === "not_in",
    },
    value: {
      type: "string",
      label: "Value",
      showWhen: (s) =>
        ["eq", "ne", "lt", "lte", "gt", "gte", "contains", "not_contains"].includes(
          String(s.operator ?? ""),
        ),
    },
    low: { type: "string", label: "From", showWhen: (s) => s.operator === "between" },
    high: { type: "string", label: "To", showWhen: (s) => s.operator === "between" },
    case_insensitive: {
      type: "boolean",
      label: "Case-insensitive",
      default: false,
      showWhen: (s) =>
        ["contains", "not_contains", "eq", "ne"].includes(String(s.operator ?? "")),
    },
  },

  // --- Math ---
  math: {
    column: { type: "column-ref", label: "Column", required: true },
    op: {
      type: "enum",
      label: "Operation",
      options: [
        { value: "neg_log10", label: "−log10(x)" },
        { value: "log10", label: "log10(x)" },
        { value: "ln", label: "ln(x)" },
        { value: "log2", label: "log2(x)" },
        { value: "exp", label: "exp(x)" },
        { value: "sqrt", label: "√x" },
        { value: "abs", label: "|x|" },
        { value: "negate", label: "−x" },
        { value: "round", label: "round" },
        { value: "floor", label: "floor" },
        { value: "ceil", label: "ceil" },
        { value: "clip", label: "clip (clamp to min/max)" },
        { value: "add", label: "+ add" },
        { value: "subtract", label: "− subtract" },
        { value: "multiply", label: "× multiply" },
        { value: "divide", label: "÷ divide" },
        { value: "power", label: "^ power" },
      ],
      default: "neg_log10",
    },
    operand: {
      type: "string",
      label: "Operand (number or column)",
      showWhen: (s) =>
        ["add", "subtract", "multiply", "divide", "power"].includes(
          String(s.op ?? ""),
        ),
    },
    decimals: {
      type: "int",
      label: "Decimal places",
      default: 0,
      min: 0,
      showWhen: (s) => s.op === "round",
    },
    min: {
      type: "string",
      label: "Min",
      placeholder: "e.g. 1e-300 (leave blank for none)",
      showWhen: (s) => s.op === "clip",
    },
    max: {
      type: "string",
      label: "Max",
      placeholder: "leave blank for none",
      showWhen: (s) => s.op === "clip",
    },
    into: {
      type: "string",
      label: "Output column",
      placeholder: "blank = replace the column",
    },
  },

  // --- Rows ---
  deduplicate: {
    columns: {
      type: "column-ref-list",
      label: "Key columns (optional)",
      description:
        "Drop rows where these columns are identical. Leave blank to deduplicate by all columns.",
    },
    keep: {
      type: "enum",
      label: "Keep",
      options: [
        { value: "first", label: "First match" },
        { value: "last", label: "Last match" },
      ],
      default: "first",
    },
    order_by: {
      type: "column-ref",
      label: "Order by (optional)",
      description: "Which row wins per key — e.g. lowest p-value.",
    },
    order_dir: {
      type: "enum",
      label: "Direction",
      options: [
        { value: "asc", label: "Ascending (smallest first)" },
        { value: "desc", label: "Descending (largest first)" },
      ],
      default: "asc",
    },
  },

  explode_column: {
    column: {
      type: "column-ref",
      label: "Column to explode",
      description:
        "Each row with a delimiter-separated value in this column becomes multiple rows, one per split value.",
      required: true,
    },
    delimiter: { type: "string", label: "Delimiter", default: ",", required: true },
    trim: { type: "boolean", label: "Trim whitespace", default: true },
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

  // --- Domain ---
  parse_variant_id: {
    column: {
      type: "column-ref",
      label: "Variant ID column",
      description: 'Parses "chr1:16979534:A:T" into chromosome + position.',
      required: true,
    },
    capture_alleles: {
      type: "boolean",
      label: "Also capture ref / alt alleles",
      default: false,
    },
  },

  map_gene_id: {
    column: { type: "column-ref", label: "Gene ID column", required: true },
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
    drop_unmapped: { type: "boolean", label: "Drop unmapped rows", default: false },
  },

  // --- Advanced ---
  compute: {
    output: { type: "string", label: "Output column", required: true },
    expression: {
      type: "string",
      label: "Expression",
      description: 'SQL expression over existing columns, e.g. "(start + end) / 2".',
      required: true,
    },
  },

  // Legacy reference only — excluded from the picker (see source-workarea).
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

/** Transform categories, in the order they should appear in the picker. A
 *  category with no transforms is simply skipped. */
export const TRANSFORM_CATEGORY_ORDER = [
  "Columns",
  "Text",
  "Values",
  "Math",
  "Rows",
  "Domain",
  "Advanced",
] as const;

export type TransformCategory = (typeof TRANSFORM_CATEGORY_ORDER)[number];

/** Display metadata for the transform-type picker (grouped + searchable). */
export const transformTypeMeta: Array<{
  value: string;
  label: string;
  description: string;
  category: TransformCategory;
}> = [
  { value: "rename", label: "Rename", description: "Rename columns", category: "Columns" },
  { value: "select", label: "Select", description: "Keep or drop columns", category: "Columns" },
  { value: "concat_columns", label: "Concat columns", description: "Join columns into one", category: "Columns" },

  { value: "format_text", label: "Format text", description: "Upper/lowercase, trim", category: "Text" },
  { value: "affix", label: "Affix", description: "Add or strip a prefix/suffix", category: "Text" },
  { value: "find_replace", label: "Find & replace", description: "Replace text (regex optional)", category: "Text" },
  { value: "extract", label: "Extract", description: "Pull part of a value into a new column", category: "Text" },
  { value: "split_column", label: "Split column", description: "Split one column into several", category: "Text" },

  { value: "coerce_numeric", label: "Coerce numeric", description: "Text → number, NULL on bad", category: "Values" },
  { value: "normalize_nulls", label: "Normalize nulls", description: "NA / . / empty → null", category: "Values" },
  { value: "replace_values", label: "Replace values", description: "Map values to others", category: "Values" },
  { value: "drop_nulls", label: "Drop nulls", description: "Drop rows with null", category: "Values" },
  { value: "filter", label: "Filter", description: "Keep/drop rows by condition", category: "Values" },

  { value: "math", label: "Math", description: "−log10, + − × ÷, round…", category: "Math" },

  { value: "deduplicate", label: "Deduplicate", description: "Drop duplicate rows", category: "Rows" },
  { value: "explode_column", label: "Explode column", description: "One row per delimiter-separated value", category: "Rows" },
  { value: "aggregate", label: "Aggregate", description: "Group by + aggregate", category: "Rows" },

  { value: "parse_variant_id", label: "Parse variant ID", description: "chr1:123:A:T → chr/pos", category: "Domain" },
  { value: "map_gene_id", label: "Map gene ID", description: "Ensembl → HGNC", category: "Domain" },

  { value: "compute", label: "Compute", description: "Derived column from a SQL expression", category: "Advanced" },
  // `custom` is legacy reference code — excluded from the picker allow-list.
  { value: "custom", label: "Custom", description: "Named function (parse_evidence, apply_f_trait)", category: "Advanced" },
];
