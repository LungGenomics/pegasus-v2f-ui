import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df[col].str.removeprefix(prefix) */
export function transformStripPrefix(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  const prefix = config.prefix!;
  if (!table.columnNames().includes(col)) return table;
  return table.derive({
    [col]: escape((d: Record<string, unknown>) => {
      const v = String(d[col] ?? "");
      return v.startsWith(prefix) ? v.slice(prefix.length) : v;
    }),
  });
}
