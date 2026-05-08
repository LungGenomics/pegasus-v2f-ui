import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: pd.to_numeric(df[col], errors="coerce") */
export function transformCoerceNumeric(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  if (!table.columnNames().includes(col)) return table;
  return table.derive({
    [col]: escape((d: Record<string, unknown>) => {
      const n = Number(d[col]);
      return Number.isNaN(n) ? null : n;
    }),
  });
}
