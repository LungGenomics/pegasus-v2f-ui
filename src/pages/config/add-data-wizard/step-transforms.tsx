// Wizard step 3: transforms (Phase 7 — folded-in deferred chunk).
//
// Optional cleanup/reshape pipeline applied to the raw table *before*
// the column mapping projection — same ordering as pipeline/route.ts.
// Reuses the same TransformEditor/TransformPicker the source-detail
// editor uses, so behavior is identical to editing transforms later.
// Mapping (next step) still maps canonical fields against the *raw*
// column names, consistent with the rest of the app; the common case
// here (explode_column) doesn't rename columns.

import { SchemaFormProvider } from "../../../components/schema-form/context";
import { TransformEditor } from "../transform-editor";
import { TransformPicker } from "../transform-picker";
import type { WizardState } from "./types";

interface Props {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepTransforms({ state, onPatch, onBack, onNext }: Props) {
  const transforms = state.transforms;
  const set = (next: typeof transforms) => onPatch({ transforms: next });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Transforms (optional)</h2>
        <p className="text-sm text-base-content/60 mt-1">
          Clean or reshape the raw rows before they're mapped and built.
          Transforms run in order, <strong>before</strong> column mapping —
          e.g. <code className="text-xs">explode_column</code> to split a
          comma-packed multi-trait cell into one row per trait. You can
          skip this and add transforms later from the source editor.
        </p>
      </div>

      <SchemaFormProvider columns={state.rawColumns}>
        <div className="space-y-2">
          {transforms.map((t, i) => (
            <div
              key={i}
              className="border border-base-300 rounded-lg bg-base-100"
            >
              <TransformEditor
                config={t}
                availableColumns={state.rawColumns}
                onChange={(updated) => {
                  const next = [...transforms];
                  next[i] = updated;
                  set(next);
                }}
                onRemove={() => set(transforms.filter((_, j) => j !== i))}
                onMoveUp={() => {
                  if (i === 0) return;
                  const next = [...transforms];
                  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                  set(next);
                }}
                onMoveDown={() => {
                  if (i === transforms.length - 1) return;
                  const next = [...transforms];
                  [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                  set(next);
                }}
                isFirst={i === 0}
                isLast={i === transforms.length - 1}
              />
            </div>
          ))}
          <div className="border border-dashed border-base-300 rounded-lg px-3 py-2">
            <TransformPicker onAdd={(t) => set([...transforms, t])} />
          </div>
        </div>
      </SchemaFormProvider>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onNext}
        >
          {transforms.length === 0 ? "Skip — next: mapping →" : "Next: mapping →"}
        </button>
      </div>
    </div>
  );
}
