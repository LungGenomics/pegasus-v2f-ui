// Renders an editable form from an EntitySchema. Each field's input is
// chosen by its `type`; fields with `showWhen` are conditionally rendered.
// Validation runs on submit and on field blur.

import { useMemo, useState } from "react";
import type {
  EntitySchema,
  FieldSchema,
  FormState,
  FieldError,
} from "./types";
import { validateForm } from "./types";
import { useSchemaFormContext } from "./context";

export type SchemaFormProps = {
  schema: EntitySchema;
  initialValue?: FormState;
  onSubmit: (value: FormState) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  busy?: boolean;
};

export function SchemaForm({
  schema,
  initialValue = {},
  onSubmit,
  onCancel,
  submitLabel = "Save",
  busy = false,
}: SchemaFormProps) {
  const [state, setState] = useState<FormState>(() =>
    withDefaults(schema, initialValue),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const visibleEntries = useMemo(() => {
    return Object.entries(schema).filter(
      ([, field]) => !field.showWhen || field.showWhen(state),
    );
  }, [schema, state]);

  const setField = (name: string, value: unknown) => {
    setState((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const { [name]: _omit, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateForm(schema, state);
    if (errs.length > 0) {
      setErrors(toErrorMap(errs));
      return;
    }
    setErrors({});
    await onSubmit(state);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {visibleEntries.map(([name, field]) => (
        <FormField
          key={name}
          name={name}
          field={field}
          value={state[name]}
          error={errors[name]}
          onChange={(v) => setField(name, v)}
        />
      ))}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-ghost btn-sm"
            disabled={busy}
          >
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// --- Stateless field renderer ------------------------------------------
// Exported so other components (e.g. inline transform-params editor) can
// reuse single-field rendering without the surrounding form/state.

export function SchemaFields({
  schema,
  value,
  onChange,
  errors = {},
}: {
  schema: EntitySchema;
  value: FormState;
  onChange: (next: FormState) => void;
  errors?: Record<string, string>;
}) {
  const visible = Object.entries(schema).filter(
    ([, field]) => !field.showWhen || field.showWhen(value),
  );
  return (
    <>
      {visible.map(([name, field]) => (
        <FormField
          key={name}
          name={name}
          field={field}
          value={value[name]}
          error={errors[name]}
          onChange={(v) => onChange({ ...value, [name]: v })}
        />
      ))}
    </>
  );
}

export function FormField({
  name,
  field,
  value,
  error,
  onChange,
}: {
  name: string;
  field: FieldSchema;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const id = `field-${name}`;
  const { availableColumns } = useSchemaFormContext();
  return (
    <div className="form-control">
      <label htmlFor={id} className="label py-1">
        <span className="label-text text-sm">
          {field.label}
          {field.required && <span className="text-error ml-0.5">*</span>}
        </span>
      </label>
      {renderInput(id, field, value, onChange, availableColumns)}
      {field.description && !error && (
        <span className="text-xs text-base-content/60 mt-1">
          {field.description}
        </span>
      )}
      {error && <span className="text-xs text-error mt-1">{error}</span>}
    </div>
  );
}

function renderInput(
  id: string,
  field: FieldSchema,
  value: unknown,
  onChange: (v: unknown) => void,
  availableColumns: string[],
): React.ReactElement {
  switch (field.type) {
    case "string":
      return (
        <input
          id={id}
          type="text"
          className="input input-bordered input-sm w-full"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "text":
      return (
        <textarea
          id={id}
          className="textarea textarea-bordered textarea-sm w-full"
          rows={field.rows ?? 3}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "int":
      return (
        <input
          id={id}
          type="number"
          className="input input-bordered input-sm w-full"
          value={(value as number | undefined) ?? ""}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
        />
      );
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          className="toggle toggle-sm"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "enum":
      return (
        <select
          id={id}
          className="select select-bordered select-sm w-full"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            — choose —
          </option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "list": {
      // Render as a comma-separated text input; trim and split on save.
      const list = (value as string[] | undefined) ?? [];
      return (
        <input
          id={id}
          type="text"
          className="input input-bordered input-sm w-full"
          value={list.join(", ")}
          placeholder={field.placeholder ?? "comma-separated"}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            )
          }
        />
      );
    }
    case "mapping": {
      const map = (value as Record<string, string> | undefined) ?? {};
      const entries = Object.entries(map);
      const update = (next: Array<[string, string]>) => {
        const obj: Record<string, string> = {};
        for (const [k, v] of next) {
          if (k.trim()) obj[k.trim()] = v;
        }
        onChange(obj);
      };
      return (
        <div className="space-y-1.5">
          {entries.length === 0 && (
            <div className="text-xs text-base-content/40 italic">
              No entries — click "Add" below.
            </div>
          )}
          {entries.map(([k, v], i) => (
            <div key={i} className="flex gap-1.5 items-center">
              {field.keyAsColumnRef && availableColumns.length > 0 ? (
                <select
                  className="select select-bordered select-xs flex-1"
                  value={k}
                  onChange={(e) => {
                    const next = [...entries] as Array<[string, string]>;
                    next[i] = [e.target.value, v];
                    update(next);
                  }}
                >
                  <option value="">— column —</option>
                  {availableColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="input input-bordered input-xs flex-1"
                  value={k}
                  placeholder={field.keyLabel ?? "key"}
                  onChange={(e) => {
                    const next = [...entries] as Array<[string, string]>;
                    next[i] = [e.target.value, v];
                    update(next);
                  }}
                />
              )}
              <span className="text-base-content/40 text-xs">→</span>
              {field.valueOptions ? (
                <select
                  className="select select-bordered select-xs flex-1"
                  value={v}
                  onChange={(e) => {
                    const next = [...entries] as Array<[string, string]>;
                    next[i] = [k, e.target.value];
                    update(next);
                  }}
                >
                  <option value="" disabled>
                    — choose —
                  </option>
                  {field.valueOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : field.valueAsColumnRef && availableColumns.length > 0 ? (
                <select
                  className="select select-bordered select-xs flex-1"
                  value={v}
                  onChange={(e) => {
                    const next = [...entries] as Array<[string, string]>;
                    next[i] = [k, e.target.value];
                    update(next);
                  }}
                >
                  <option value="">— column —</option>
                  {availableColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="input input-bordered input-xs flex-1"
                  value={v}
                  placeholder={field.valueLabel ?? "value"}
                  onChange={(e) => {
                    const next = [...entries] as Array<[string, string]>;
                    next[i] = [k, e.target.value];
                    update(next);
                  }}
                />
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  const next = entries.filter((_, j) => j !== i);
                  update(next as Array<[string, string]>);
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => update([...entries, ["", ""]] as Array<[string, string]>)}
          >
            + Add
          </button>
        </div>
      );
    }
    case "column-ref": {
      // Select when columns are known; plain text otherwise.
      if (availableColumns.length === 0) {
        return (
          <input
            id={id}
            type="text"
            className="input input-bordered input-sm w-full"
            value={(value as string) ?? ""}
            placeholder={field.placeholder ?? "column name"}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
      return (
        <select
          id={id}
          className="select select-bordered select-sm w-full"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— select column —</option>
          {availableColumns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }
    case "column-ref-list": {
      const list = (value as string[] | undefined) ?? [];
      if (availableColumns.length === 0) {
        // Fallback to comma-separated text input
        return (
          <input
            id={id}
            type="text"
            className="input input-bordered input-sm w-full"
            value={list.join(", ")}
            placeholder={field.placeholder ?? "comma-separated column names"}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              )
            }
          />
        );
      }
      // Chip-style multi-select: show selected as chips, add via dropdown.
      const remaining = availableColumns.filter((c) => !list.includes(c));
      return (
        <div className="space-y-1.5">
          {list.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {list.map((c) => (
                <span
                  key={c}
                  className="badge badge-sm badge-outline gap-1 pr-1"
                >
                  {c}
                  <button
                    type="button"
                    className="hover:text-error"
                    onClick={() => onChange(list.filter((x) => x !== c))}
                    title={`Remove ${c}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-base-content/40 italic">
              No columns selected.
            </div>
          )}
          {remaining.length > 0 && (
            <select
              className="select select-bordered select-xs w-full"
              value=""
              onChange={(e) => {
                if (e.target.value) onChange([...list, e.target.value]);
              }}
            >
              <option value="">+ Add column…</option>
              {remaining.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
  }
}

// --- Helpers ------------------------------------------------------------

function withDefaults(schema: EntitySchema, initial: FormState): FormState {
  const out: FormState = { ...initial };
  for (const [name, field] of Object.entries(schema)) {
    if (out[name] !== undefined) continue;
    if ("default" in field && field.default !== undefined) {
      out[name] = field.default;
    }
  }
  return out;
}

function toErrorMap(errs: FieldError[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errs) {
    if (!out[e.field]) out[e.field] = e.message;
  }
  return out;
}
