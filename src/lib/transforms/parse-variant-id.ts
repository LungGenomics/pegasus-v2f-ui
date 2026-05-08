import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: regex r"^(?:chr)?(\w+)[:\-_](\d+)" -> extracts chr and pos */
export function transformParseVariantId(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const targetCol = config.column!;
  const colNames = table.columnNames();
  // Case-insensitive column lookup (matches Python behavior)
  const col =
    colNames.find((c) => c.toLowerCase() === targetCol.toLowerCase()) ??
    targetCol;
  if (!colNames.includes(col)) return table;

  const re = /^(?:chr)?(\w+)[:\-_](\d+)/;

  return table.derive({
    chr: escape((d: Record<string, unknown>) => {
      const m = String(d[col] ?? "").match(re);
      return m ? m[1] : null;
    }),
    pos: escape((d: Record<string, unknown>) => {
      const m = String(d[col] ?? "").match(re);
      return m ? Number(m[2]) : null;
    }),
  });
}
