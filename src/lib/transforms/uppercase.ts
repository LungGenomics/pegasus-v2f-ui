import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df[col].str.upper() */
export function transformUppercase(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  if (!table.columnNames().includes(col)) return table;
  return table.derive({
    [col]: escape((d: Record<string, unknown>) => {
      const v = d[col];
      return v == null ? v : String(v).toUpperCase();
    }),
  });
}
