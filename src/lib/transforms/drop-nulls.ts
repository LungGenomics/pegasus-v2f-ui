import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: dropna(subset=[col]) then filter out whitespace-only strings */
export function transformDropNulls(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  if (!table.columnNames().includes(col)) return table;
  return table.filter(
    escape((d: Record<string, unknown>) => {
      const v = d[col];
      if (v == null) return false;
      if (typeof v === "string" && v.trim() === "") return false;
      return true;
    }),
  );
}
