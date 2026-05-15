import { Plus } from "lucide-react";
import { transformTypeMeta } from "../../data/config-schema/transforms";
import type { TransformConfigEntry } from "../../api/types";

interface Props {
  onAdd: (config: TransformConfigEntry) => void;
}

/** Default config when adding a new transform of the given type — matches
 *  what the per-type schema in `data/config-schema/transforms.ts` expects. */
function defaultConfig(type: string): TransformConfigEntry {
  switch (type) {
    case "rename":
      return { type, columns: {} };
    case "select":
      return { type, columns: [] };
    case "deduplicate":
      return { type, columns: [] };
    case "strip_prefix":
      return { type, column: "", prefix: "" };
    case "uppercase":
      return { type, column: "" };
    case "drop_nulls":
      return { type, columns: [] };
    case "coerce_numeric":
      return { type, columns: [] };
    case "filter_values":
      return { type, column: "", values: [] } as TransformConfigEntry;
    case "parse_variant_id":
      return { type, column: "" };
    case "split_column":
      return { type, column: "", delimiter: ",", columns: [] };
    case "explode_column":
      return { type, column: "", delimiter: ",", trim: true } as TransformConfigEntry;
    case "aggregate":
      return { type, group_by: [], agg: {} };
    case "compute":
      return { type, output: "", expression: "" };
    case "map_gene_id":
      return { type, column: "", from: "ensembl", to: "hgnc", drop_unmapped: false };
    case "custom":
      return { type, custom_function: "" } as TransformConfigEntry;
    default:
      return { type } as TransformConfigEntry;
  }
}

export function TransformPicker({ onAdd }: Props) {
  return (
    <div className="dropdown dropdown-top">
      <div tabIndex={0} role="button" className="btn btn-sm btn-ghost gap-1">
        <Plus className="size-4" />
        Add Transform
      </div>
      <div
        tabIndex={0}
        className="dropdown-content shadow-lg bg-base-100 border border-base-300 rounded-lg w-72 max-h-80 overflow-y-auto z-10 p-1"
      >
        {transformTypeMeta.map((t) => (
          <button
            key={t.value}
            type="button"
            className="w-full text-left flex flex-col gap-0 px-2 py-1.5 rounded hover:bg-base-200"
            onClick={() => {
              onAdd(defaultConfig(t.value));
              (document.activeElement as HTMLElement)?.blur();
            }}
          >
            <span className="font-mono text-sm">{t.value}</span>
            <span className="text-xs text-base-content/50">
              {t.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
