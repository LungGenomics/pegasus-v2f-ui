import { type ColumnTable, escape } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df.eval(expression) — arithmetic only */
export function transformCompute(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const output = config.output!;
  const expr = config.expression!;
  const colNames = table.columnNames();

  // Validate: only allow column names, numbers, arithmetic ops, parens, whitespace
  let sanitized = expr;
  // Sort longest-first to avoid partial matches
  const sorted = [...colNames].sort((a, b) => b.length - a.length);
  for (const col of sorted) {
    sanitized = sanitized.split(col).join("");
  }
  if (!/^[\s\d+\-*/().]+$/.test(sanitized)) {
    throw new Error(`Unsafe expression: ${expr}`);
  }

  // Build derive expression with column accessors
  const colSet = new Set(colNames);
  const body = expr.replace(/\b(\w+)\b/g, (m) =>
    colSet.has(m) ? `d["${m}"]` : m,
  );

  return table.derive({
    [output]: escape(new Function("d", `return ${body}`) as (d: Record<string, unknown>) => unknown),
  });
}
