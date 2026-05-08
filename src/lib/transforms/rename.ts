import { type ColumnTable } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df.rename(columns={old: new}) — skips missing columns */
export function transformRename(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const mapping = config.columns as Record<string, string>;
  const existing = new Set(table.columnNames());
  const valid: Record<string, string> = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (existing.has(from)) valid[from] = to;
  }
  return Object.keys(valid).length ? table.rename(valid) : table;
}
