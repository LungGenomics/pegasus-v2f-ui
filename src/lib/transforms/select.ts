import { type ColumnTable } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df[columns] with range syntax "ColA:ColB" */
export function transformSelect(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const cols = config.columns;
  if (typeof cols === "string" && cols.includes(":")) {
    const parts = cols.split(":");
    const start = parts[0];
    const end = parts[1];
    const names = table.columnNames();
    const si = start ? names.indexOf(start) : -1;
    const ei = end ? names.indexOf(end) : -1;
    if (si === -1 || ei === -1) return table;
    return table.select(names.slice(si, ei + 1));
  }
  const existing = new Set(table.columnNames());
  const keep = (cols as string[]).filter((c) => existing.has(c));
  return table.select(keep);
}
