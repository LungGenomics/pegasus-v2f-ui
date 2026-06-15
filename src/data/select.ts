import {
  hasSavedDuckDB,
  getSavedHandle,
  getSavedWalHandle,
  saveDuckDB,
  resetWal,
  clearDuckDB,
  clearWal,
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

/** Cheap existence check for a table in main schema. Lets callers
 *  gracefully skip queries against tables that don't exist yet on a
 *  fresh DB without DuckDB-WASM emitting noisy worker-side errors —
 *  the worker logs SQL errors to console even when our code catches
 *  the rejection. Cached briefly so repeated calls in one render
 *  pass don't hammer information_schema. */
const _existsCache = new Map<string, { ts: number; exists: boolean }>();
const EXISTS_TTL_MS = 2000;
export async function tableExists(name: string): Promise<boolean> {
  const cached = _existsCache.get(name);
  if (cached && Date.now() - cached.ts < EXISTS_TTL_MS) {
    return cached.exists;
  }
  try {
    const rows = await getDataSource().query<{ x: number }>({
      sql:
        "SELECT 1 AS x FROM information_schema.tables " +
        "WHERE table_schema = 'main' AND table_name = ? LIMIT 1",
      params: [name],
    });
    const exists = rows.length > 0;
    _existsCache.set(name, { ts: Date.now(), exists });
    return exists;
  } catch {
    return false;
  }
}

export function subscribeDataSource(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function notify() {
  for (const l of _listeners) l();
}

// --- Initial shared-DB download progress -------------------------------------
// Streamed byte progress for the first-load pull of the shared DuckDB from R2,
// so the boot screen can show a real progress bar instead of a static spinner.
// `total` is null when the server didn't send Content-Length (indeterminate).
export type BootProgress = { loaded: number; total: number | null } | null;

let _bootProgress: BootProgress = null;
const _progressListeners = new Set<() => void>();

export function getBootProgress(): BootProgress {
  return _bootProgress;
}
export function subscribeBootProgress(listener: () => void): () => void {
  _progressListeners.add(listener);
  return () => _progressListeners.delete(listener);
}
function setBootProgress(p: BootProgress) {
  _bootProgress = p;
  for (const l of _progressListeners) l();
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
      // Reuse the existing WAL — it holds unflushed edits from the
      // previous session and must NOT be reset on restore.
      const walHandle = await getSavedWalHandle();
      const m = await import("./adapters/duckdb-wasm");
      await m.attachOpfsHandle(handle, walHandle);
      const ds = new m.DuckDBWasmDataSource();
      await ensureSchema(ds);
      _instance = ds;
      _state = "duckdb-wasm";
      notify();
      return "duckdb-wasm" as const;
    } catch (err) {
      console.error("Failed to restore DuckDB from OPFS:", err);
      // A failed restore can leave the worker alive still holding the
      // exclusive OPFS sync-access handle on the DB file, which then
      // blocks every later attach/save (createSyncAccessHandle /
      // createWritable throw "another open Access Handle"). Tear the
      // worker down so recovery paths (Load shared / Create new) can
      // reacquire the file.
      try {
        const m = await import("./adapters/duckdb-wasm");
        await m.disposeAll();
      } catch {
        /* best effort */
      }
      _initPromise = null;
      throw err;
    }
  })();
  return _initPromise;
}

export async function attachDuckDBFile(file: File): Promise<void> {
  const log = (msg: string) => console.info(`[attachFile] ${msg}`);
  // Tear down any existing DuckDB instance first — the worker holds an
  // exclusive sync access handle on the OPFS file, which would block our
  // createWritable() call when overwriting it with new bytes.
  const m = await import("./adapters/duckdb-wasm");
  log("disposing prior worker");
  await m.disposeAll();

  log("writing bytes to OPFS");
  try {
    await saveDuckDB(file);
  } catch (err) {
    // The OPFS file is locked by an open sync-access handle. After
    // disposeAll() the in-page worker is gone, so the most common
    // remaining cause is the browser not having released the handle
    // yet (give it a tick) or a stale file from a crashed session
    // (delete + rewrite — a fresh file has no prior handle).
    console.warn("[attachFile] OPFS write failed, retrying after reset:", err);
    await new Promise((r) => setTimeout(r, 200));
    try {
      await clearDuckDB();
      await clearWal();
    } catch {
      /* removeEntry may also be locked — the retry below will surface it */
    }
    try {
      await saveDuckDB(file);
    } catch (err2) {
      throw new Error(
        "The local database file is locked and couldn't be replaced. " +
          "This almost always means the app is open in another browser " +
          "tab — close all other tabs of this app, then reload and try " +
          `again. (underlying: ${
            err2 instanceof Error ? err2.message : String(err2)
          })`,
      );
    }
  }
  const handle = await getSavedHandle();
  if (handle) {
    // Loading a fresh main file — a stale WAL from a prior session
    // would corrupt it. Truncate then attach the empty WAL handle.
    await resetWal();
    const walHandle = await getSavedWalHandle();
    log("attaching OPFS handle");
    await m.attachOpfsHandle(handle, walHandle);
  } else {
    // OPFS unavailable — fall back to in-memory attach (this session only)
    log("OPFS unavailable; in-memory attach");
    await m.attachFile(file);
  }
  const ds = new m.DuckDBWasmDataSource();
  log("running migrations");
  await ensureSchema(ds);
  _instance = ds;
  _state = "duckdb-wasm";
  _initPromise = null;
  log("done — notifying listeners");
  notify();
}

export async function detachDuckDB(): Promise<void> {
  const m = await import("./adapters/duckdb-wasm");
  await m.disposeAll();
  await clearDuckDB();
  await clearWal();
  _instance = null;
  _state = "none";
  _initPromise = null;
  notify();
}

// Base URL of the R2 bucket hosting the shared DB. Overridable via a
// VITE_SHARED_DB_BASE build env var; falls back to the lab's r2.dev
// dev URL. `import.meta.env` isn't typed for custom keys, so cast.
const SHARED_DB_BASE = (
  (import.meta.env as Record<string, string | undefined>)
    .VITE_SHARED_DB_BASE ??
  "https://pub-3dbe6972d0bd4328a532eba3d5fa449d.r2.dev"
).replace(/\/+$/, "");

// Phase A of the R2 sync plan: read-only "load shared database".
// Fetches the pointer (latest.json) → the DB object it names → clones
// the bytes into OPFS and attaches via the normal file path. The
// migration runner is idempotent, so a CLI-built gene.duckdb that
// predates the redesigned config.* schema gets it applied on attach.
export async function loadSharedDuckDB(): Promise<void> {
  const log = (m: string) => console.info(`[loadShared] ${m}`);
  log("fetching latest.json");
  const ptrRes = await fetch(`${SHARED_DB_BASE}/latest.json`, {
    cache: "no-store",
  });
  if (!ptrRes.ok) {
    throw new Error(
      `Couldn't fetch shared DB pointer (${ptrRes.status} ${ptrRes.statusText})`,
    );
  }
  const ptr = (await ptrRes.json()) as { current_key?: string };
  if (!ptr.current_key) {
    throw new Error("latest.json is missing a current_key field");
  }
  log(`pointer → ${ptr.current_key}; fetching DB bytes`);
  const dbRes = await fetch(`${SHARED_DB_BASE}/${ptr.current_key}`);
  if (!dbRes.ok) {
    throw new Error(
      `Couldn't fetch shared DB '${ptr.current_key}' (${dbRes.status} ${dbRes.statusText})`,
    );
  }
  // Stream the body so the boot screen can show download progress. Fall back
  // to a plain arrayBuffer() read if the body isn't a readable stream.
  const total = Number(dbRes.headers.get("Content-Length")) || null;
  let buf: ArrayBuffer;
  const reader = dbRes.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    setBootProgress({ loaded: 0, total });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        setBootProgress({ loaded, total });
      }
    } finally {
      setBootProgress(null); // clear so a later boot path doesn't show stale bytes
    }
    const merged = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    buf = merged.buffer;
  } else {
    buf = await dbRes.arrayBuffer();
  }
  log(`fetched ${buf.byteLength} bytes; wrapping as File`);
  const file = new File([buf], "shared.duckdb", {
    type: "application/octet-stream",
  });
  log("attaching via attachDuckDBFile");
  await attachDuckDBFile(file);
  // The shared DB just pulled from R2 *is* the published baseline —
  // snapshot the dirty-tracker so local edits after this read dirty.
  try {
    const { snapshotPublishState } = await import("./dirtyState");
    await snapshotPublishState(ptr.current_key);
  } catch (err) {
    console.warn("[loadShared] publish-state baseline skipped:", err);
  }
  log("done");
}

// Spin up a fresh empty DuckDB and persist it to OPFS. Two phases:
//   (1) build the DB in memory via registerEmptyFileBuffer + ATTACH so the
//       migration runner has somewhere valid to write — DuckDB rejects raw
//       0-byte files when ATTACHed.
//   (2) copy the resulting bytes out via copyFileToBuffer, write to OPFS,
//       dispose the worker, re-attach via the OPFS handle so subsequent
//       writes are durably persisted.
// Bundled empty DuckDB file (built once with `duckdb empty.duckdb -c
// "PRAGMA version"`). ~12 KB. Used as the starting bytes for "Create
// new database" so we don't depend on duckdb-wasm's copyFileToBuffer
// (which throws a bare Exception {} in 1.33.1-dev45 after ATTACH).
import emptyDuckdbUrl from "./empty.duckdb?url";

export async function createNewDuckDB(name = "new.duckdb"): Promise<void> {
  // Strategy:
  //   1. Fetch the bundled empty DuckDB bytes (built with the host CLI).
  //   2. Write those bytes to OPFS.
  //   3. ATTACH the OPFS handle.
  //   4. Run migrations against the live OPFS-backed DB — writes flow
  //      through BROWSER_FSACCESS directly to OPFS, so we never have
  //      to copy bytes back out of duckdb-wasm.
  //
  // This sidesteps copyFileToBuffer entirely, which the 1.33.1-dev45
  // worker rejects with a bare Exception {} after ATTACH.
  const log = (msg: string) => console.info(`[createNewDuckDB] ${msg}`);
  const m = await import("./adapters/duckdb-wasm");
  log("disposing prior worker");
  await m.disposeAll();
  log("clearing OPFS");
  await clearDuckDB();
  await clearWal();

  log(`fetching empty DuckDB bytes from ${emptyDuckdbUrl}`);
  const res = await fetch(emptyDuckdbUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch bundled empty DuckDB (${res.status} ${res.statusText})`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  log(`got ${bytes.byteLength} empty-DB bytes`);

  const blob = new Blob([bytes.slice().buffer], {
    type: "application/octet-stream",
  });
  log("writing empty bytes to OPFS");
  await saveDuckDB(new File([blob], name, { type: "application/octet-stream" }));
  const handle = await getSavedHandle();
  if (!handle) {
    throw new Error(
      "OPFS not available in this browser — can't persist the new database.",
    );
  }

  // Brand-new DB — clear any leftover WAL so it doesn't corrupt the
  // fresh main file.
  await resetWal();
  const walHandle = await getSavedWalHandle();
  log("attaching from OPFS handle");
  await m.attachOpfsHandle(handle, walHandle);
  const ds = new m.DuckDBWasmDataSource();
  log("running migrations against OPFS-backed DB");
  await ensureSchema(ds);

  _instance = ds;
  _state = "duckdb-wasm";
  _initPromise = null;
  // Fresh empty DB — baseline is "nothing published"; snapshot so an
  // empty _publish_state exists (any source added later reads dirty).
  try {
    const { snapshotPublishState } = await import("./dirtyState");
    await snapshotPublishState();
  } catch (err) {
    console.warn("[createNew] publish-state baseline skipped:", err);
  }
  log("done — notifying listeners");
  notify();
}

// Raw bytes of the OPFS-backed .duckdb after a CHECKPOINT — used by
// Publish to upload the working copy to R2. Throws on an in-memory
// (non-OPFS) session since there's no durable file to publish.
export async function exportDuckDBBytes(): Promise<Uint8Array> {
  if (!_instance) throw new Error("No DB attached");
  try {
    await _instance.exec({ sql: "CHECKPOINT" });
  } catch (err) {
    console.warn("CHECKPOINT before export failed (continuing):", err);
  }
  const handle = await getSavedHandle();
  if (!handle) {
    throw new Error(
      "This session isn't OPFS-backed (in-memory) — nothing durable to publish.",
    );
  }
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
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
