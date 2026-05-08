import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df[df[col].str.match(pattern, na=False)] */
export function transformFilterValues(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const col = config.column!;
  const pattern = config.pattern!;
  if (!table.columnNames().includes(col)) return table;
  const re = new RegExp(pattern);
  return table.filter(
    escape((d: Record<string, unknown>) => {
      const v = d[col];
      if (v == null) return false;
      return re.test(String(v));
    }),
  );
}
