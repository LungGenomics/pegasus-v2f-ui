import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Requires gene map injected from API (Map<ensemblId, hgncSymbol>) */
export function transformMapGeneId(
  table: ColumnTable,
  config: TransformConfig,
  geneMap?: Map<string, string>,
): ColumnTable {
  const col = config.column!;
  if (!table.columnNames().includes(col)) return table;
  if (!geneMap) {
    throw new Error(
      "Gene map not loaded — Phase 1c will load HGNC into a gene_mapping table",
    );
  }

  const dropUnmapped = config.drop_unmapped ?? false;

  // Strip version suffix and map
  let result = table.derive({
    [col]: escape((d: Record<string, unknown>) => {
      const raw = String(d[col] ?? "");
      const bare = raw.replace(/\.\d+$/, ""); // strip version
      const mapped = geneMap.get(bare);
      return mapped ?? (dropUnmapped ? null : raw);
    }),
  });

  if (dropUnmapped) {
    result = result.filter(
      escape((d: Record<string, unknown>) => d[col] != null),
    );
  }

  return result;
}
