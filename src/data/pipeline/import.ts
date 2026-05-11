// STUB during Phase 0 of the web-first config redesign
// (2026-05-11-config-redesign-web-first.md). The legacy import pipeline
// (V2fSourceConfig + evidence_blocks) doesn't match the new schema and
// will be replaced by src/data/pipeline/{load,route,loci,build}.ts in
// Phase 1.
//
// Keeping the export so api/sources.ts compiles; throwing at runtime
// makes it loud if the broken Build button is ever clicked before Phase
// 1 ships.

export type ImportResult = {
  source_id: string;
  raw_table: string;
  rows: number;
  evidence_rows: number;
  evidence_per_block: Array<{ source_tag: string; rows: number }>;
};

export async function importSource(): Promise<ImportResult> {
  throw new Error(
    "Build pipeline is being rewritten as part of the web-first config " +
      "redesign (Phase 1). Try again once that lands.",
  );
}
