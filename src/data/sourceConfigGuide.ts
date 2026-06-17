// Generates the downloadable AGENTS.md authoring guide for adding a source from
// existing data. Built at RUNTIME from the same constants the app uses
// (EVIDENCE_CATEGORIES, the transform schemas, CANONICAL_FIELDS, SOURCE_TYPES),
// so the guide can never drift out of sync when a category / transform / field
// is added. The Add-source panel serializes this into a downloadable file.

import { EVIDENCE_CATEGORIES, CATEGORY_VALUE_LABELS } from "./static";
import {
  transformTypeMeta,
  transformSchemas,
  TRANSFORM_CATEGORY_ORDER,
} from "./config-schema/transforms";
import { CANONICAL_FIELDS, requiredFields } from "./canonicalFields";
import { SOURCE_TYPES, SOURCE_NAME_RE } from "./configIO";
import type { FieldSchema } from "../components/schema-form/types";

/** Human-readable type tag for a transform param. */
function paramType(f: FieldSchema): string {
  switch (f.type) {
    case "column-ref":
      return "column";
    case "column-ref-list":
      return "column[]";
    case "list":
      return "string[]";
    case "mapping":
      return "object";
    case "int":
      return "integer";
    default:
      return f.type; // string | boolean | enum
  }
}

/** One markdown bullet describing a single transform param. */
function describeParam(name: string, f: FieldSchema): string {
  const head = `\`${name}\` (${paramType(f)}${f.required ? ", required" : ""})`;
  const notes: string[] = [];
  if (f.description) notes.push(f.description.replace(/\s+/g, " ").trim());
  if (f.type === "enum") {
    notes.push("one of: " + f.options.map((o) => `\`${o.value}\``).join(", "));
  }
  if (f.type === "mapping") {
    notes.push(`${f.keyLabel ?? "key"} → ${f.valueLabel ?? "value"}`);
    if (f.valueOptions) {
      notes.push(
        "value one of: " +
          f.valueOptions.map((o) => `\`${o.value}\``).join(", "),
      );
    }
  }
  if (f.showWhen) notes.push("only for certain option values");
  if (
    "default" in f &&
    f.default !== undefined &&
    f.default !== "" &&
    f.default !== false &&
    !(Array.isArray(f.default) && f.default.length === 0)
  ) {
    const d = Array.isArray(f.default)
      ? `[${(f.default as string[]).join(", ")}]`
      : String(f.default);
    notes.push(`default: \`${d}\``);
  }
  return `  - ${head}${notes.length ? " — " + notes.join("; ") : ""}`;
}

/** Transform catalog, grouped by category, rendered from the live schemas. */
function transformCatalog(): string {
  const lines: string[] = [];
  for (const category of TRANSFORM_CATEGORY_ORDER) {
    const inCat = transformTypeMeta.filter(
      // `custom` is legacy reference code, excluded from the picker.
      (t) => t.category === category && t.value !== "custom",
    );
    if (!inCat.length) continue;
    lines.push(`### ${category}`, "");
    for (const t of inCat) {
      lines.push(`#### \`${t.value}\` — ${t.label}`);
      lines.push(t.description + ".");
      const schema = transformSchemas[t.value];
      const params = schema ? Object.entries(schema) : [];
      if (params.length) {
        lines.push("");
        lines.push("Params:");
        for (const [name, field] of params) {
          lines.push(describeParam(name, field as FieldSchema));
        }
      } else {
        lines.push("");
        lines.push("_No params._");
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Evidence-category reference table with the suggested value labels. */
function evidenceCategoryTable(): string {
  const rows = Object.entries(EVIDENCE_CATEGORIES).map(([code, label]) => {
    const v = CATEGORY_VALUE_LABELS[code];
    const primary = v?.primary ? `\`${v.primary}\`` : "—";
    const secondary = v?.secondary ? `\`${v.secondary}\`` : "—";
    return `| \`${code}\` | ${label} | ${primary} | ${secondary} |`;
  });
  return [
    "| Code | Category | Suggested primary value | Suggested secondary |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The full authoring guide as a markdown string. */
export function buildSourceConfigGuide(): string {
  const sourceTypes = [...SOURCE_TYPES].map((t) => `\`${t}\``).join(", ");
  const canonical = CANONICAL_FIELDS.map((c) => `\`${c}\``).join(", ");

  return `# Adding a source to pegasus.v2f

You are reading the authoring guide for turning **existing tabular data**
(a CSV/TSV/Parquet file, or a Google Sheet) into a **source** that pegasus.v2f
can ingest. The end product is a single JSON config document that the app
imports in one shot.

This file was generated from the running app's own schema, so the categories,
transforms, and fields below are exactly what this build accepts.

> **Audience note (for AI agents):** the user will give you a data file or
> sheet. Your job is to inspect its columns and produce a valid config JSON
> (the shape in §1). Do not invent column names — use the real headers from the
> data. Leave \`source.url\` as a \`<<placeholder>>\` only if the user hasn't
> given you the real location yet; the importer rejects unreplaced placeholders.

## The pipeline

A source flows through three stages, and the config has one block per stage:

1. **\`source\`** — where the raw data lives and how to load it. Ingesting
   fetches it and materializes a *raw table* (one column per header).
2. **\`transforms\`** — an ordered list of cleaning steps (a small DSL) applied
   to the raw table. Each step consumes the previous step's output. This is
   where you split a variant id into chromosome + position, convert a p-value to
   −log10, coerce text to numbers, drop bad rows, map Ensembl ids to gene
   symbols, etc. → produces a *clean table*.
3. **\`mappings\`** — projections from clean columns into pegasus.v2f's canonical
   output streams. Each mapping targets either \`evidence\` (one evidence row per
   input row, in a category) or \`loci\` (genomic windows merged into loci).

## 1. The config document

\`\`\`json
{
  "source": { "...": "..." },
  "transforms": [ { "type": "...", "...": "..." } ],
  "mappings": [ { "target": "evidence | loci", "...": "..." } ]
}
\`\`\`

\`transforms\` and \`mappings\` are optional but a useful source has both. Import
several such documents at once on the Sources page (see §6).

## 2. The \`source\` block

| Field | Required | Notes |
| --- | --- | --- |
| \`name\` | yes | Stable id. Must match \`${SOURCE_NAME_RE.source}\` (lowercase letter first, then letters/digits/underscores). |
| \`source_type\` | yes | One of: ${sourceTypes}. |
| \`url\` | for non-file types | The data location. A Google Sheets share URL, or a direct CSV/TSV/Parquet URL. |
| \`sheet\` | googlesheets only | Tab name; defaults to the first tab. |
| \`skip_rows\` | no | Header/preamble rows to skip before the column row. |
| \`display_name\` | no | Human-readable label shown in the UI. |
| \`description\` | no | Free text. |
| \`citation\` | no | Source citation / DOI. |

## 3. The \`transforms\` array

Each step is a flat object: a \`type\` discriminant plus that type's params
inline, e.g. \`{ "type": "math", "column": "pval", "op": "neg_log10", "into": "neglog_p" }\`.

Steps run **in order**, each on the output of the one before, so sequence
matters — e.g. \`coerce_numeric\` a p-value column *before* a \`math\` step uses
it. Some params apply only for certain option values (noted below).

${transformCatalog()}

## 4. The \`mappings\` array

A mapping projects clean columns into one canonical output stream.

Common fields:

- \`target\` (required) — \`"evidence"\` or \`"loci"\`.
- \`source_tag\` (required) — a short label for this projection (free text).
- \`display_name\` — optional human-readable label.

**For \`target: "evidence"\`:**

- \`centric\` — \`"variant"\` (row keyed by chromosome + position, then fanned to
  the locus's candidate genes) or \`"gene"\` (row keyed by gene symbol).
- \`evidence_category\` (required) — one of the codes in §5.
- \`primary_value_column\` (required) — the clean column whose value is each
  row's primary numeric value (a plain alias — do the math in \`transforms\`).
- \`secondary_value_column\` — optional second value (e.g. an effect size).
- \`primary_value_label\` / \`secondary_value_label\` — descriptive labels for
  those values (e.g. \`"−log10 p"\`, \`"effect size"\`). See §5 for the
  per-category conventions.
- \`fields\` — array of \`{ "canonical_field": "...", "raw_column": "..." }\`
  binding pieces of context to clean columns. Allowed canonical fields:
  ${canonical}.

**For \`target: "loci"\`:**

- \`window_kb\` — half-window (kb) drawn around each position.
- \`merge_distance_kb\` — nearby windows within this distance merge into one
  locus.
- \`fields\` — must supply \`chromosome\` and \`position\`.

**Required canonical fields** depend on target and centric (these are mandatory
in \`fields\`):

- \`evidence\` + \`centric: "gene"\` → ${requiredFields("evidence", "gene").map((f) => `\`${f}\``).join(", ")}
- \`evidence\` + \`centric: "variant"\` → ${requiredFields("evidence", "variant").map((f) => `\`${f}\``).join(", ")}
- \`loci\` → ${requiredFields("loci").map((f) => `\`${f}\``).join(", ")}

**Traits.** A mapping can attach traits two ways:

- \`trait_scope: "constant"\` with \`trait_labels: ["..."]\` — every row gets the
  same trait(s). Traits travel by **label** (resolved or created on import), so
  a config is portable across databases.
- \`trait_scope: "column"\` with \`trait_column: { "raw_column": "...", "trait_id_lookup": "..." }\`
  — the trait is read per-row from a column.

## 5. Evidence categories

Pick the code whose meaning matches the evidence. The suggested value labels are
the common convention for that category's \`primary_value_label\` /
\`secondary_value_label\` — descriptive only, they don't constrain the numbers.

${evidenceCategoryTable()}

## 6. Worked example

A GWAS Google Sheet with columns \`variant\` (\`chr1:16979534:A:T\`), \`pval\`, and
\`beta\`. We parse the variant, convert p to −log10, and emit both an evidence
stream and loci.

\`\`\`json
{
  "source": {
    "name": "lung_fvc_gwas",
    "source_type": "googlesheets",
    "display_name": "Lung FVC GWAS (2024)",
    "url": "https://docs.google.com/spreadsheets/d/<<SHEET_ID>>/edit",
    "sheet": "results",
    "skip_rows": 0,
    "citation": "Doe et al. 2024, doi:10.0000/example"
  },
  "transforms": [
    { "type": "parse_variant_id", "column": "variant", "capture_alleles": false },
    { "type": "coerce_numeric", "columns": ["pval", "beta"] },
    { "type": "math", "column": "pval", "op": "neg_log10", "into": "neglog_p" },
    { "type": "drop_nulls", "columns": ["chromosome", "position"], "mode": "any" }
  ],
  "mappings": [
    {
      "source_tag": "fvc_gwas_evidence",
      "target": "evidence",
      "centric": "variant",
      "evidence_category": "GWAS",
      "primary_value_column": "neglog_p",
      "primary_value_label": "−log10 p",
      "secondary_value_column": "beta",
      "secondary_value_label": "effect size",
      "fields": [
        { "canonical_field": "chromosome", "raw_column": "chromosome" },
        { "canonical_field": "position", "raw_column": "position" }
      ],
      "trait_scope": "constant",
      "trait_labels": ["forced vital capacity"]
    },
    {
      "source_tag": "fvc_gwas_loci",
      "target": "loci",
      "window_kb": 500,
      "merge_distance_kb": 250,
      "fields": [
        { "canonical_field": "chromosome", "raw_column": "chromosome" },
        { "canonical_field": "position", "raw_column": "position" }
      ]
    }
  ]
}
\`\`\`

## 7. Importing

1. Open the **Sources** page in pegasus.v2f.
2. Click the **{ }** (braces) button in the Sources list header — "import a
   source from config JSON".
3. Drop your config file(s) or paste the JSON, review the staged list, and
   import. Each config is ingested independently; results are reported per
   source, and the derived loci/evidence views rebuild afterward.

### Validation the importer enforces

- \`source.name\` must match \`${SOURCE_NAME_RE.source}\`.
- \`source.source_type\` must be one of: ${sourceTypes}.
- \`source.url\` must not still contain a \`<<placeholder>>\`.
- Each mapping's \`target\` must be \`"evidence"\` or \`"loci"\`, and have a
  non-empty \`source_tag\`.
- Per-mapping problems are reported individually; valid mappings still apply.
`;
}
