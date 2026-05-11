// Schema-as-code metadata for editable entities. The SchemaForm component
// renders forms from these definitions — adding a config field becomes one
// schema entry instead of editing form components.
//
// Per the DB-first config plan, each `config.*` table has a corresponding
// schema in src/data/config-schema/. JSON Schema covers transform params
// separately (heterogeneous, validation-focused).

export type FormState = Record<string, unknown>;

export type Validator =
  | { type: "regex"; pattern: string; message: string }
  | { type: "min-length"; value: number; message?: string }
  | { type: "max-length"; value: number; message?: string }
  | { type: "min"; value: number; message?: string }
  | { type: "max"; value: number; message?: string };

type FieldBase = {
  label: string;
  description?: string;
  required?: boolean;
  /** Render only when this predicate returns true given the current form state. */
  showWhen?: (state: FormState) => boolean;
  validators?: Validator[];
  /** UI hint — when wrapping in a multi-column form layout. */
  width?: "full" | "half";
};

export type StringField = FieldBase & {
  type: "string";
  default?: string;
  placeholder?: string;
};

export type TextField = FieldBase & {
  type: "text";
  default?: string;
  placeholder?: string;
  rows?: number;
};

export type IntField = FieldBase & {
  type: "int";
  default?: number;
  min?: number;
  max?: number;
  step?: number;
};

export type BooleanField = FieldBase & {
  type: "boolean";
  default?: boolean;
};

export type EnumField = FieldBase & {
  type: "enum";
  default?: string;
  options: Array<{ value: string; label: string; description?: string }>;
};

/** Comma-separated list rendered as a single input; values stored as string[]. */
export type ListField = FieldBase & {
  type: "list";
  default?: string[];
  placeholder?: string;
};

/** Column-ref field: renders as a select populated from the SchemaFormProvider's
 *  availableColumns. Falls back to a plain text input when no context columns
 *  are available — keeps the schema-driven editor functional outside the
 *  transform pipeline (e.g., when no preview has run yet). */
export type ColumnRefField = FieldBase & {
  type: "column-ref";
  default?: string;
  placeholder?: string;
};

/** List of column refs — multi-pick dropdown / chip editor. */
export type ColumnRefListField = FieldBase & {
  type: "column-ref-list";
  default?: string[];
  placeholder?: string;
};

/** Key→value mapping. Used for rename (old→new column names), aggregate
 *  (column→function), and evidence-block fields (evidence-column→raw-column).
 *  Rendered as a list of (key, value) input pairs. */
export type MappingField = FieldBase & {
  type: "mapping";
  default?: Record<string, string>;
  keyLabel?: string;
  valueLabel?: string;
  /** When true, render the key input as a column-ref select. */
  keyAsColumnRef?: boolean;
  /** When true, render the value input as a column-ref select. */
  valueAsColumnRef?: boolean;
  /** Restrict values to this fixed set (e.g., aggregate functions). */
  valueOptions?: Array<{ value: string; label: string }>;
};

/** Array of nested objects, each rendered with its own EntitySchema. The UX
 *  bundles add / remove / collapse around each item — useful for evidence
 *  blocks, future per-source thresholds, etc. */
export type ListOfObjectsField = FieldBase & {
  type: "list-of-objects";
  itemSchema: EntitySchema;
  /** Default value for newly-added items. */
  defaultItem?: FormState;
  /** Singular noun shown on the "Add ..." button and as each item's title. */
  itemLabel?: string;
  /** Optional accessor that returns a short summary string for each item
   *  (shown next to the index when collapsed). */
  summarize?: (item: FormState) => string;
};

/** Trait picker — delegates to <TraitInput>, which combines local
 *  config.traits autocomplete with OLS search. Stored as string[] of
 *  trait_ids; the form layer hides the ontology / enrichment plumbing. */
export type TraitListField = FieldBase & {
  type: "trait-list";
  default?: string[];
  /** When true, only one trait can be selected at a time. */
  single?: boolean;
  /** Restrict OLS search to specific ontologies. */
  ontologies?: string[];
  placeholder?: string;
};

export type FieldSchema =
  | StringField
  | TextField
  | IntField
  | BooleanField
  | EnumField
  | ListField
  | MappingField
  | ColumnRefField
  | ColumnRefListField
  | ListOfObjectsField
  | TraitListField;

export type EntitySchema = Record<string, FieldSchema>;

// --- Validation -----------------------------------------------------------

export type FieldError = { field: string; message: string };

/** Run schema-level validation. Returns errors keyed by field name. */
export function validateForm(
  schema: EntitySchema,
  state: FormState,
): FieldError[] {
  const errors: FieldError[] = [];
  for (const [name, field] of Object.entries(schema)) {
    if (field.showWhen && !field.showWhen(state)) continue;
    const value = state[name];
    const isEmpty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && isEmpty) {
      errors.push({ field: name, message: `${field.label} is required` });
      continue;
    }
    if (isEmpty) continue;
    for (const v of field.validators ?? []) {
      const err = runValidator(v, value, field.label);
      if (err) errors.push({ field: name, message: err });
    }
  }
  return errors;
}

function runValidator(
  v: Validator,
  value: unknown,
  label: string,
): string | null {
  switch (v.type) {
    case "regex":
      if (typeof value !== "string") return null;
      return new RegExp(v.pattern).test(value) ? null : v.message;
    case "min-length":
      if (typeof value !== "string") return null;
      return value.length >= v.value
        ? null
        : (v.message ?? `${label} must be at least ${v.value} characters`);
    case "max-length":
      if (typeof value !== "string") return null;
      return value.length <= v.value
        ? null
        : (v.message ?? `${label} must be at most ${v.value} characters`);
    case "min":
      if (typeof value !== "number") return null;
      return value >= v.value
        ? null
        : (v.message ?? `${label} must be at least ${v.value}`);
    case "max":
      if (typeof value !== "number") return null;
      return value <= v.value
        ? null
        : (v.message ?? `${label} must be at most ${v.value}`);
  }
}
