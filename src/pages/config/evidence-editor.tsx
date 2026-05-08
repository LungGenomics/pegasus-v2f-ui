// Evidence-blocks editor for one source. The outer component manages the
// array (add / remove blocks) and remains hand-built; each block's fields
// render via the schema-driven form using evidenceBlockSchema.

import { Plus, Trash2 } from "lucide-react";
import type { V2fEvidenceBlock } from "../../api/types";
import { SchemaFields } from "../../components/schema-form/schema-form";
import { SchemaFormProvider } from "../../components/schema-form/context";
import { evidenceBlockSchema } from "../../data/config-schema/evidence-block";
import type { FormState } from "../../components/schema-form/types";

interface Props {
  evidence: V2fEvidenceBlock[];
  availableColumns: string[];
  onChange: (evidence: V2fEvidenceBlock[]) => void;
}

export function EvidenceEditor({ evidence, availableColumns, onChange }: Props) {
  const updateBlock = (index: number, block: V2fEvidenceBlock) => {
    const next = [...evidence];
    next[index] = block;
    onChange(next);
  };

  const removeBlock = (index: number) => {
    onChange(evidence.filter((_, i) => i !== index));
  };

  const addBlock = () => {
    onChange([
      ...evidence,
      {
        source_tag: "",
        category: "OTHER",
        centric: "gene",
        fields: {},
      } as V2fEvidenceBlock,
    ]);
  };

  return (
    <SchemaFormProvider columns={availableColumns}>
      <div className="space-y-3">
        {evidence.map((block, i) => (
          <BlockCard
            key={i}
            block={block}
            onChange={(b) => updateBlock(i, b)}
            onRemove={() => removeBlock(i)}
          />
        ))}
        <button className="btn btn-ghost btn-sm gap-1" onClick={addBlock}>
          <Plus className="size-4" /> Add evidence block
        </button>
      </div>
    </SchemaFormProvider>
  );
}

function BlockCard({
  block,
  onChange,
  onRemove,
}: {
  block: V2fEvidenceBlock;
  onChange: (b: V2fEvidenceBlock) => void;
  onRemove: () => void;
}) {
  // The form sees the block as a flat FormState. Cast both directions —
  // the V2fEvidenceBlock shape is open-ended already, so this is safe.
  const value = block as unknown as FormState;
  const handleChange = (next: FormState) => {
    onChange(next as unknown as V2fEvidenceBlock);
  };

  return (
    <div className="border border-base-300 rounded-lg bg-base-100 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium flex-1">Evidence block</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs text-error"
          onClick={onRemove}
          title="Remove evidence block"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <SchemaFields
        schema={evidenceBlockSchema}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
}
