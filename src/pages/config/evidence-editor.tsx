import { Plus, Trash2, X } from "lucide-react";
import type { V2fEvidenceBlock } from "../../api/types";

const CATEGORIES = ["COLOC", "MR", "FUNC", "PHEWAS", "RARE", "OMIM", "OTHER"];

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
      { source_tag: "", category: "OTHER", centric: "gene", fields: {} },
    ]);
  };

  return (
    <div className="space-y-3">
      {evidence.map((ev, i) => (
        <EvidenceBlockEditor
          key={i}
          block={ev}
          columns={availableColumns}
          onChange={(b) => updateBlock(i, b)}
          onRemove={() => removeBlock(i)}
        />
      ))}
      <button className="btn btn-ghost btn-sm gap-1" onClick={addBlock}>
        <Plus className="size-4" /> Add evidence block
      </button>
    </div>
  );
}

function EvidenceBlockEditor({
  block,
  columns,
  onChange,
  onRemove,
}: {
  block: V2fEvidenceBlock;
  columns: string[];
  onChange: (b: V2fEvidenceBlock) => void;
  onRemove: () => void;
}) {
  const fields = block.fields ?? {};

  const updateField = (key: string, value: string) => {
    onChange({ ...block, fields: { ...fields, [key]: value } });
  };

  const removeField = (key: string) => {
    const updated = { ...fields };
    delete updated[key];
    onChange({ ...block, fields: updated });
  };

  const addField = () => {
    onChange({ ...block, fields: { ...fields, "": "" } });
  };

  return (
    <div className="border border-base-300 rounded-lg bg-base-100 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium flex-1">Evidence</span>
        <button className="btn btn-ghost btn-xs text-error" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">Source tag</span>
          </div>
          <input
            className="input input-bordered input-xs w-full font-mono"
            value={block.source_tag}
            placeholder="source_tag"
            onChange={(e) => onChange({ ...block, source_tag: e.target.value })}
          />
        </label>
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">Category</span>
          </div>
          <select
            className="select select-bordered select-xs w-full"
            value={block.category}
            onChange={(e) => onChange({ ...block, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">Centric</span>
          </div>
          <select
            className="select select-bordered select-xs w-full"
            value={block.centric ?? "gene"}
            onChange={(e) => onChange({ ...block, centric: e.target.value })}
          >
            <option value="gene">gene</option>
            <option value="locus">locus</option>
          </select>
        </label>
        <label className="form-control w-full">
          <div className="label py-0.5">
            <span className="label-text text-xs">Role</span>
          </div>
          <input
            className="input input-bordered input-xs w-full"
            value={block.role ?? ""}
            placeholder="(optional)"
            onChange={(e) => onChange({ ...block, role: e.target.value || undefined })}
          />
        </label>
      </div>

      {/* Field mappings */}
      <div className="space-y-1">
        <span className="text-xs text-base-content/50">Field mappings</span>
        {Object.entries(fields).map(([key, val], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className="input input-bordered input-xs flex-1"
              value={key}
              placeholder="field name"
              onChange={(e) => {
                const updated = { ...fields };
                delete updated[key];
                updated[e.target.value] = val;
                onChange({ ...block, fields: updated });
              }}
            />
            <span className="text-xs text-base-content/30">→</span>
            <select
              className="select select-bordered select-xs flex-1"
              value={val}
              onChange={(e) => updateField(key, e.target.value)}
            >
              <option value="">Column...</option>
              {columns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-xs" onClick={() => removeField(key)}>
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost btn-xs gap-1" onClick={addField}>
          <Plus className="size-3" /> Add field
        </button>
      </div>
    </div>
  );
}
