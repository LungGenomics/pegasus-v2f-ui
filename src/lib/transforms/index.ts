/**
 * Arquero transform runtime — mirrors Python apply_transformations() dispatcher.
 *
 * Each transform is a pure function: (table, config) => table.
 * The pipeline runs client-side for instant previews.
 */

import { type ColumnTable } from "arquero";
import { transformRename } from "./rename";
import { transformSelect } from "./select";
import { transformDropNulls } from "./drop-nulls";
import { transformFilterValues } from "./filter-values";
import { transformCoerceNumeric } from "./coerce-numeric";
import { transformStripPrefix } from "./strip-prefix";
import { transformUppercase } from "./uppercase";
import { transformDeduplicate } from "./deduplicate";
import { transformSplitColumn } from "./split-column";
import { transformAggregate } from "./aggregate";
import { transformCompute } from "./compute";
import { transformParseVariantId } from "./parse-variant-id";
import { transformMapGeneId } from "./map-gene-id";

export interface TransformConfig {
  type: string;
  column?: string;
  columns?: Record<string, string> | string[] | string;
  pattern?: string;
  prefix?: string;
  delimiter?: string;
  index?: number;
  output?: string;
  group_by?: string | string[];
  agg?: Record<string, string>;
  expression?: string;
  from?: string;
  to?: string;
  drop_unmapped?: boolean;
  custom_function?: string;
}

export interface PipelineStage {
  transform: TransformConfig;
  table: ColumnTable;
  rowCount: number;
  columnNames: string[];
  error?: string;
}

export interface PipelineResult {
  raw: { table: ColumnTable; rowCount: number; columnNames: string[] };
  stages: PipelineStage[];
}

type TransformFn = (
  table: ColumnTable,
  config: TransformConfig,
  geneMap?: Map<string, string>,
) => ColumnTable;

const TRANSFORMS: Record<string, TransformFn> = {
  rename: transformRename,
  select: transformSelect,
  drop_nulls: transformDropNulls,
  filter_values: transformFilterValues,
  coerce_numeric: transformCoerceNumeric,
  strip_prefix: transformStripPrefix,
  uppercase: transformUppercase,
  deduplicate: transformDeduplicate,
  split_column: transformSplitColumn,
  aggregate: transformAggregate,
  compute: transformCompute,
  parse_variant_id: transformParseVariantId,
  map_gene_id: transformMapGeneId,
};

export function applyTransformations(
  raw: ColumnTable,
  transforms: TransformConfig[],
  geneMap?: Map<string, string>,
): PipelineResult {
  const stages: PipelineStage[] = [];
  let current = raw;

  for (const config of transforms) {
    const fn = TRANSFORMS[config.type];
    if (!fn) {
      stages.push({
        transform: config,
        table: current,
        rowCount: current.numRows(),
        columnNames: current.columnNames(),
        error: `Unknown transform type: ${config.type}`,
      });
      continue;
    }
    try {
      const next = fn(current, config, geneMap);
      current = next;
      stages.push({
        transform: config,
        table: current,
        rowCount: current.numRows(),
        columnNames: current.columnNames(),
      });
    } catch (err) {
      stages.push({
        transform: config,
        table: current,
        rowCount: current.numRows(),
        columnNames: current.columnNames(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    raw: {
      table: raw,
      rowCount: raw.numRows(),
      columnNames: raw.columnNames(),
    },
    stages,
  };
}
