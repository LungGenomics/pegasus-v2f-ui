import { type ColumnTable } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df.drop_duplicates(subset=[col], keep="first") */
export function transformDeduplicate(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  if (!table.columnNames().includes(col)) return table;
  return table.dedupe(col);
}
