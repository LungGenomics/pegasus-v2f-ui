// Schema-driven editor for a single transform's parameters. Looks up the
// EntitySchema for the given transform type, splits the entry into
// {type, ...params}, and renders a SchemaFields form. Updates flow back via
// onChange continuously — there's no Save button per transform; the parent
// commits on its own gesture.

import { SchemaFields } from "./schema-form";
import { transformSchemas, transformTypeMeta } from "../../data/config-schema/transforms";
import type { TransformConfigEntry } from "../../api/types";
import type { FormState } from "./types";

export type TransformParamEditorProps = {
  transform: TransformConfigEntry;
  onChange: (next: TransformConfigEntry) => void;
};

export function TransformParamEditor({
  transform,
  onChange,
}: TransformParamEditorProps) {
  const schema = transformSchemas[transform.type];
  if (!schema) {
    return (
      <div className="text-xs text-error">
        Unknown transform type: <code>{transform.type}</code>
      </div>
    );
  }

  // Split {type, ...params}: the form sees just params; we re-attach type
  // when calling onChange.
  const { type, ...params } = transform;
  const value = params as FormState;

  const handleChange = (next: FormState) => {
    onChange({ type, ...next } as TransformConfigEntry);
  };

  return (
    <div className="space-y-2">
      <SchemaFields schema={schema} value={value} onChange={handleChange} />
    </div>
  );
}

/** Pure read-only summary line for a transform — used when the user isn't
 *  actively editing it. */
export function TransformSummary({ transform }: { transform: TransformConfigEntry }) {
  const meta = transformTypeMeta.find((m) => m.value === transform.type);
  return (
    <div className="text-xs text-base-content/70">
      <span className="font-medium">{meta?.label ?? transform.type}</span>
      {meta?.description && (
        <span className="text-base-content/40 ml-2">— {meta.description}</span>
      )}
    </div>
  );
}
