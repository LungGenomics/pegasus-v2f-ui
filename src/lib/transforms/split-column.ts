import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df[col].str.split(delimiter).str[index] */
export function transformSplitColumn(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  const delim = config.delimiter ?? "_";
  const idx = config.index ?? 0;
  const out = config.output ?? col;
  if (!table.columnNames().includes(col)) return table;
  return table.derive({
    [out]: escape((d: Record<string, unknown>) => {
      const v = d[col];
      if (v == null) return null;
      const parts = String(v).split(delim);
      return idx < parts.length ? parts[idx] : null;
    }),
  });
}
