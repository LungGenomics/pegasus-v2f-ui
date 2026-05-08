import {
  hasSavedDuckDB,
  getSavedHandle,
  saveDuckDB,
  clearDuckDB,
  getMeta,
} from "./opfs";
import { ensureSchema } from "./migrations";
import type { DataSource, DataSourceCapabilities } from "./types";

export type DataSourceState = "none" | "duckdb-wasm";

let _instance: DataSource | null = null;
let _state: DataSourceState = "none";
const _listeners = new Set<() => void>();

const NO_DB_ERROR =
  "No DuckDB file open. Click 'Open .duckdb' to attach one.";

class NoSourceDataSource implements DataSource {
  capabilities: DataSourceCapabilities = {
    canWrite: false,
    canRunPipeline: false,
    persistence: "none",
    label: "No source attached",
  };
  query(): Promise<never[]> {
    return Promise.reject(new Error(NO_DB_ERROR));
  }
  exec(): Promise<void> {
    return Promise.reject(new Error(NO_DB_ERROR));
  }
}

const _noSource = new NoSourceDataSource();

export function getDataSourceState(): DataSourceState {
  return _state;
}

export function isAttached(): boolean {
  return _state === "duckdb-wasm" && _instance !== null;
}

export function getDataSource(): DataSource {
  return _instance ?? _noSource;
}

export function subscribeDataSource(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function notify() {
  for (const l of _listeners) l();
}

// Async bootstrap — call once at app mount. If OPFS has a previously-saved
// .duckdb, attach it. Otherwise leave the no-source sentinel in place; the
// app shows the picker landing.
//
// Memoized so React StrictMode's double-mount in dev doesn't race two
// attaches against the same DuckDB instance.
let _initPromise: Promise<DataSourceState> | null = null;

export function initDataSource(): Promise<DataSourceState> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!(await hasSavedDuckDB())) return "none" as const;
    try {
      const handle = await getSavedHandle();
      if (!handle) return "none" as const;
      const m = await import("./adapters/duckdb-wasm");
      await m.attachOpfsHandle(handle);
      const ds = new m.DuckDBWasmDataSource();
      await ensureSchema(ds);
      _instance = ds;
      _state = "duckdb-wasm";
      notify();
      return "duckdb-wasm" as const;
    } catch (err) {
      console.error("Failed to restore DuckDB from OPFS:", err);
      _initPromise = null;
      throw err;
    }
  })();
  return _initPromise;
}

export async function attachDuckDBFile(file: File): Promise<void> {
  // Tear down any existing DuckDB instance first — the worker holds an
  // exclusive sync access handle on the OPFS file, which would block our
  // createWritable() call when overwriting it with new bytes.
  const m = await import("./adapters/duckdb-wasm");
  await m.disposeAll();

  await saveDuckDB(file);
  const handle = await getSavedHandle();
  if (handle) {
    await m.attachOpfsHandle(handle);
  } else {
    // OPFS unavailable — fall back to in-memory attach (this session only)
    await m.attachFile(file);
  }
  const ds = new m.DuckDBWasmDataSource();
  await ensureSchema(ds);
  _instance = ds;
  _state = "duckdb-wasm";
  _initPromise = null;
  notify();
}

export async function detachDuckDB(): Promise<void> {
  const m = await import("./adapters/duckdb-wasm");
  await m.disposeAll();
  await clearDuckDB();
  _instance = null;
  _state = "none";
  _initPromise = null;
  notify();
}

// Spin up a fresh empty DuckDB and persist it to OPFS. Two phases:
//   (1) build the DB in memory via registerEmptyFileBuffer + ATTACH so the
//       migration runner has somewhere valid to write — DuckDB rejects raw
//       0-byte files when ATTACHed.
//   (2) copy the resulting bytes out via copyFileToBuffer, write to OPFS,
//       dispose the worker, re-attach via the OPFS handle so subsequent
//       writes are durably persisted.
export async function createNewDuckDB(name = "new.duckdb"): Promise<void> {
  const m = await import("./adapters/duckdb-wasm");
  await m.disposeAll();
  await clearDuckDB();

  // Phase 1: in-memory init + migrations
  await m.attachInMemoryAsGene();
  const initDs = new m.DuckDBWasmDataSource();
  await ensureSchema(initDs);
  const bytes = await m.exportGeneToBuffer();

  // Phase 2: persist to OPFS, re-attach
  await m.disposeAll();
  // Slice into a non-shared ArrayBuffer — TS's File constructor types reject
  // SharedArrayBuffer-backed Uint8Arrays.
  const blob = new Blob([new Uint8Array(bytes).slice().buffer], {
    type: "application/octet-stream",
  });
  await saveDuckDB(new File([blob], name, { type: "application/octet-stream" }));
  const handle = await getSavedHandle();
  if (!handle) {
    throw new Error(
      "OPFS not available in this browser — can't persist the new database.",
    );
  }
  await m.attachOpfsHandle(handle);
  const ds = new m.DuckDBWasmDataSource();
  // ensureSchema is idempotent — _migrations table already lists version 1.
  await ensureSchema(ds);

  _instance = ds;
  _state = "duckdb-wasm";
  _initPromise = null;
  notify();
}

// Trigger a Blob download of the OPFS-backed .duckdb. CHECKPOINT first so any
// in-flight writes are flushed to the main file before we read it.
export async function exportDuckDB(): Promise<void> {
  if (!_instance) {
    throw new Error("No DB attached");
  }
  try {
    await _instance.exec({ sql: "CHECKPOINT" });
  } catch (err) {
    console.warn("CHECKPOINT before export failed (continuing):", err);
  }
  const handle = await getSavedHandle();
  if (!handle) {
    throw new Error("No saved file to export.");
  }
  const file = await handle.getFile();
  const meta = getMeta();
  const filename = meta?.name ?? "pegasus.duckdb";
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
