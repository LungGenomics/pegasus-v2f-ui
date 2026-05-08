import { Plus } from "lucide-react";
import { useTransformTypes } from "../../api/config";
import type { TransformConfigEntry } from "../../api/types";

interface Props {
  onAdd: (config: TransformConfigEntry) => void;
}

/** Default config when adding a new transform of the given type. */
function defaultConfig(type: string): TransformConfigEntry {
  switch (type) {
    case "rename":
      return { type, columns: {} };
    case "select":
      return { type, columns: [] };
    case "filter_values":
      return { type, column: "", pattern: "" };
    case "strip_prefix":
      return { type, column: "", prefix: "" };
    case "split_column":
      return { type, column: "", delimiter: "_", index: 0 };
    case "aggregate":
      return { type, group_by: [], agg: {} };
    case "compute":
      return { type, output: "", expression: "" };
    case "map_gene_id":
      return { type, column: "", from: "ensembl", to: "hgnc", drop_unmapped: false };
    default:
      return { type, column: "" };
  }
}

export function TransformPicker({ onAdd }: Props) {
  const { data: types } = useTransformTypes();

  if (!types) return null;

  return (
    <div className="dropdown dropdown-top dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-sm btn-ghost gap-1">
        <Plus className="size-4" />
        Add Transform
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content z-10 menu p-1 shadow-lg bg-base-100 border border-base-300 rounded-lg w-72 max-h-64 overflow-y-auto"
      >
        {types.map((t) => (
          <li key={t.type}>
            <button
              className="flex flex-col items-start gap-0 py-1.5"
              onClick={() => {
                onAdd(defaultConfig(t.type));
                // Close dropdown by blurring
                (document.activeElement as HTMLElement)?.blur();
              }}
            >
              <span className="font-mono text-sm">{t.type}</span>
              <span className="text-xs text-base-content/50">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
