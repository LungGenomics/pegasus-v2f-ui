import { type ColumnTable, op } from "arquero";
import type { TransformConfig } from "./index";

/** Python: df.groupby(group_by).agg(agg_dict) */
export function transformAggregate(
  table: ColumnTable,
  config: TransformConfig,
): ColumnTable {
  const groupBy = Array.isArray(config.group_by)
    ? config.group_by
    : [config.group_by!];
  const agg = config.agg!;

  const existing = new Set(table.columnNames());
  if (!groupBy.every((c) => existing.has(c))) return table;
  if (!Object.keys(agg).every((c) => existing.has(c))) return table;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aggFns: Record<string, (col: string) => any> = {
    min: (c) => op.min(c),
    max: (c) => op.max(c),
    mean: (c) => op.mean(c),
    sum: (c) => op.sum(c),
    count: () => op.count(),
    // 'first' not in arquero op — use array_agg as fallback
    first: (c) => op.array_agg(c),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rollup: Record<string, any> = {};
  for (const [col, fn] of Object.entries(agg)) {
    const aggFn = aggFns[fn];
    if (aggFn) rollup[col] = aggFn(col);
  }

  return table.groupby(groupBy).rollup(rollup);
}
