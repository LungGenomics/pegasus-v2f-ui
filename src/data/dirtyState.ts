// Local dirty-tracker (Phase 4, plan 2026-05-19).
//
// Publish is a whole-file snapshot (Phase 5 / the R2 plan), so this
// never computes a transferable diff. Its only jobs: gate Publish,
// drive per-source "modified" badges, and feed the audit. Granularity
// is per-source; the signature is **content-derived** (a canonical
// serialization of the source's inputs incl. its derivation child
// rows) — NOT a row_version proxy, because mappings/transforms live in
// child tables and a parent-counter proxy can silently miss edits.

import { getDataSource } from "./select";
import { listSources } from "./sourceOps";
import { listMappingsForSource } from "./mappingOps";
import { listSourceTransforms } from "./sourceTransformOps";

// Reserved _publish_state key for config that isn't owned by any source —
// trait entities and the singleton settings. The nil UUID is never a real
// source id, and _publish_state has no FK, so storing the global sig under it
// is safe. Publish snapshots the whole DB, so a trait/ontology or settings
// edit must flip dirty even when no source changed.
const GLOBAL_CONFIG_KEY = "00000000-0000-0000-0000-000000000000";

/** Deterministic JSON: object keys sorted recursively. */
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(",")}}`;
}

/** Content signature of one source: top-level fields + raw_version +
 *  every derivation with its child rows (mappings/transforms/traits/
 *  trait_column). Any change to any of these flips the signature by
 *  construction. */
export async function computeSourceSig(
  sourceId: string,
): Promise<string> {
  const ds = getDataSource();
  const [src] = await ds.query<{
    name: string;
    display_name: string | null;
    description: string | null;
    source_type: string;
    url: string | null;
    sheet: string | null;
    skip_rows: number | null;
    row_version: number | null;
    raw_version: number | null;
  }>({
    sql:
      "SELECT name, display_name, description, source_type, url, sheet, " +
      "skip_rows, row_version, raw_version FROM config.sources WHERE id = ?",
    params: [sourceId],
  });
  if (!src) return "";

  const [transforms, mappings] = await Promise.all([
    listSourceTransforms(sourceId),
    listMappingsForSource(sourceId),
  ]);
  const transformSig = [...transforms].sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  const mappingSig = mappings
    .map((m) => ({
      source_tag: m.source_tag,
      target: m.target,
      evidence_category: m.evidence_category ?? null,
      centric: m.centric ?? null,
      trait_scope: m.trait_scope ?? null,
      window_kb: m.window_kb ?? null,
      merge_distance_kb: m.merge_distance_kb ?? null,
      display_name: m.display_name ?? null,
      row_version: m.row_version ?? null,
      fields: [...(m.fields ?? [])].sort((a, b) =>
        a.canonical_field.localeCompare(b.canonical_field),
      ),
      trait_ids: [...(m.trait_ids ?? [])].sort(),
      trait_column: m.trait_column ?? null,
    }))
    .sort((a, b) => a.source_tag.localeCompare(b.source_tag));

  return canon({
    name: src.name,
    display_name: src.display_name,
    description: src.description,
    source_type: src.source_type,
    url: src.url,
    sheet: src.sheet,
    skip_rows: src.skip_rows ?? 0,
    row_version: src.row_version ?? 0,
    raw_version: src.raw_version ?? 0,
    transforms: transformSig,
    mappings: mappingSig,
  });
}

/** Signature of config not owned by a source — trait entities + the singleton
 *  settings. `row_version` (bumped on every trait/settings write) is the
 *  catch-all; the explicit columns make a diff debuggable. */
export async function computeGlobalConfigSig(): Promise<string> {
  const ds = getDataSource();
  const traits = await ds.query<Record<string, unknown>>({
    sql:
      "SELECT id, label, description, primary_ontology, primary_ontology_id, " +
      "ontology_label, trait_kind, trait_kind_overridden, row_version " +
      "FROM config.traits ORDER BY id",
  });
  const [settings] = await ds.query<Record<string, unknown>>({
    sql:
      "SELECT window_kb, merge_distance_kb, candidate_gene_biotypes, " +
      "locus_definition_source, row_version " +
      "FROM config.pegasus_settings WHERE id = 1",
  });
  return canon({ traits, settings: settings ?? null });
}

export interface DirtyState {
  /** source_id → true when its sig differs from the published snapshot
   *  (or it was never published). */
  dirtySources: Set<string>;
  /** A source_id present in _publish_state but no longer in
   *  config.sources — deleted since the last publish. */
  hasDeletions: boolean;
  /** Non-source config (traits / settings) differs from the snapshot. */
  globalDirty: boolean;
  anyDirty: boolean;
  total: number;
}

export async function getDirtyState(): Promise<DirtyState> {
  const ds = getDataSource();
  const published = new Map<string, string>();
  try {
    const rows = await ds.query<{ source_id: string; sig: string }>({
      sql: "SELECT source_id, sig FROM config._publish_state",
    });
    for (const r of rows) published.set(r.source_id, r.sig);
  } catch {
    // _publish_state absent (pre-migration / read-only) → treat as
    // "nothing published yet": everything is dirty but non-fatal.
  }

  const sources = await listSources();
  const currentIds = new Set(sources.map((s) => s.id));
  const dirtySources = new Set<string>();
  for (const s of sources) {
    const sig = await computeSourceSig(s.id);
    const stored = published.get(s.id);
    if (stored !== sig) {
      dirtySources.add(s.id);
      console.warn(
        `[dirty] ${s.name}: ${!stored ? "no _publish_state row" : "sig differs"}`,
        { storedLen: stored?.length, sigLen: sig.length },
      );
    }
  }
  let hasDeletions = false;
  for (const id of published.keys()) {
    if (id === GLOBAL_CONFIG_KEY) continue; // sentinel, not a source
    if (!currentIds.has(id)) {
      hasDeletions = true;
      break;
    }
  }

  // Non-source config (traits + settings).
  const globalSig = await computeGlobalConfigSig();
  const globalDirty = published.get(GLOBAL_CONFIG_KEY) !== globalSig;
  if (globalDirty) {
    console.warn(
      `[dirty] global config (traits/settings): ${
        published.has(GLOBAL_CONFIG_KEY) ? "sig differs" : "no _publish_state row"
      }`,
    );
  }

  return {
    dirtySources,
    hasDeletions,
    globalDirty,
    anyDirty: dirtySources.size > 0 || hasDeletions || globalDirty,
    total: sources.length,
  };
}

/** Take the current state as the published baseline: recompute every
 *  source's sig and replace _publish_state. Call after loading the
 *  shared DB (it IS the published artifact) and after a successful
 *  Publish (Phase 5). The table is in-DB so it travels in snapshots. */
export async function snapshotPublishState(
  versionKey?: string,
): Promise<void> {
  const ds = getDataSource();
  const sources = await listSources();
  await ds.exec({ sql: "DELETE FROM config._publish_state" });
  for (const s of sources) {
    const sig = await computeSourceSig(s.id);
    await ds.exec({
      sql:
        "INSERT INTO config._publish_state (source_id, sig) VALUES (?, ?)",
      params: [s.id, sig],
    });
  }
  // Non-source config (traits + settings) baseline, under the reserved key.
  await ds.exec({
    sql: "INSERT INTO config._publish_state (source_id, sig) VALUES (?, ?)",
    params: [GLOBAL_CONFIG_KEY, await computeGlobalConfigSig()],
  });
  await ds.exec({ sql: "DELETE FROM config._publish_meta" });
  await ds.exec({
    sql:
      "INSERT INTO config._publish_meta (id, version_key, published_at) " +
      "VALUES (1, ?, now())",
    params: [versionKey ?? null],
  });
  // Force the WAL into the main OPFS file so the snapshot is
  // durable across a page refresh. Without this, _publish_state
  // writes can live in the in-memory WAL only (duckdb-wasm's
  // BROWSER_FSACCESS doesn't register the .wal file), and the dirty
  // tracker resurrects on next load.
  try {
    await ds.exec({ sql: "CHECKPOINT" });
  } catch (err) {
    console.warn("CHECKPOINT after snapshotPublishState failed:", err);
  }
}
