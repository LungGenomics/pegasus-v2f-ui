import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_mvp_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdb_mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdb_eh_wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdb_eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import type { DataSource, DataSourceCapabilities, Row, SqlQuery } from "../types";

// Vite resolves these ?url imports to served asset paths. Way more reliable
// than getJsDelivrBundles() which depends on the CDN serving the same
// version we have installed (especially flaky for dev releases like
// 1.33.1-dev45.0). Bundling locally also makes the build self-contained.
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdb_mvp_wasm,
    mainWorker: duckdb_mvp_worker,
  },
  eh: {
    mainModule: duckdb_eh_wasm,
    mainWorker: duckdb_eh_worker,
  },
};

// Cache the boot/connect promises (not the resolved values) so concurrent
// callers — e.g., React StrictMode firing the init effect twice in dev —
// share a single in-flight initialization rather than racing on a half-
// instantiated AsyncDuckDB.
let _bootPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let _connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

function bootDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (_bootPromise) return _bootPromise;
  _bootPromise = (async () => {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    // Classic worker — duckdb-wasm's worker scripts use importScripts(), not
    // ESM imports, so plain `new Worker(url)` (no type:"module") is correct.
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })().catch((err) => {
    // Reset on failure so the next caller can retry rather than getting
    // a permanently-rejected promise.
    _bootPromise = null;
    throw err;
  });
  return _bootPromise;
}

function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (_connPromise) return _connPromise;
  _connPromise = (async () => {
    const db = await bootDuckDB();
    return db.connect();
  })().catch((err) => {
    _connPromise = null;
    throw err;
  });
  return _connPromise;
}

async function resetConn(): Promise<void> {
  if (_connPromise) {
    try {
      const conn = await _connPromise;
      await conn.close();
    } catch {
      /* connection might be in a broken state already */
    }
    _connPromise = null;
  }
}

// Tear down everything — connection, db, worker. After this, the OPFS file
// (if any) is no longer locked by the worker, so the main thread can write
// to it via createWritable. Used when "Replace" picks a new file.
export async function disposeAll(): Promise<void> {
  await resetConn();
  if (_bootPromise) {
    try {
      const db = await _bootPromise;
      await db.terminate();
    } catch {
      /* worker might already be gone */
    }
    _bootPromise = null;
  }
  _inMemoryFile = null;
}

// In-memory file-buffer scratch DB used by createNewDuckDB. We register an
// empty buffer with duckdb-wasm, ATTACH it as 'gene', run migrations, then
// copy the resulting bytes out to OPFS. After that, the OPFS file is
// re-attached as the live DB.
let _inMemoryFile: string | null = null;

export async function attachInMemoryAsGene(): Promise<void> {
  await bootDuckDB();
  await resetConn();
  const conn = await getConn();
  const fname = `_blank_${Date.now()}.db`;
  // Do NOT registerEmptyFileBuffer — that creates a 0-byte buffer DuckDB
  // rejects as invalid. Unregistered paths fall back to the emscripten
  // virtual FS, where ATTACH on a non-existent path creates the file fresh
  // with a valid DuckDB header.
  await conn.query(`ATTACH '${fname}' AS gene`);
  await conn.query("USE gene.main");
  _inMemoryFile = fname;
}

/** Register raw bytes as a virtual file DuckDB-WASM can read via SQL
 *  (read_csv_auto, read_parquet, etc.). Used by the import pipeline. */
export async function registerSourceBytes(
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const db = await bootDuckDB();
  // Drop any prior registration with the same name first — ignore if missing.
  try {
    await db.dropFile(name);
  } catch {
    /* not registered */
  }
  await db.registerFileBuffer(name, bytes);
}

export async function dropRegisteredFile(name: string): Promise<void> {
  const db = await bootDuckDB();
  try {
    await db.dropFile(name);
  } catch {
    /* not registered */
  }
}

export async function exportGeneToBuffer(): Promise<Uint8Array> {
  if (!_inMemoryFile) {
    throw new Error("No in-memory DB attached");
  }
  const db = await bootDuckDB();
  const conn = await getConn();
  // Flush any pending writes to the buffer before copying.
  try {
    await conn.query("CHECKPOINT");
  } catch (err) {
    console.warn("CHECKPOINT before exportGeneToBuffer failed:", err);
  }
  return db.copyFileToBuffer(_inMemoryFile);
}

// Attach a `.duckdb` file the user picked from disk, and ATTACH it as the
// default catalog so unqualified queries hit those tables.
export async function attachFile(file: File): Promise<void> {
  const db = await bootDuckDB();
  const buf = new Uint8Array(await file.arrayBuffer());
  await db.registerFileBuffer(file.name, buf);
  // Close any existing connection to flush state, then reconnect against the
  // attached DB. We attach as 'gene' alias and SET it as the default schema.
  await resetConn();
  const conn = await getConn();
  await conn.query(`ATTACH '${file.name}' AS gene (READ_ONLY)`);
  await conn.query("USE gene.main");
}

// Same idea but from a URL — used for the bundled demo DB on GitHub Pages.
export async function attachUrl(url: string, alias = "gene"): Promise<void> {
  const db = await bootDuckDB();
  await db.registerFileURL(alias, url, duckdb.DuckDBDataProtocol.HTTP, false);
  await resetConn();
  const conn = await getConn();
  await conn.query(`ATTACH '${alias}' AS ${alias} (READ_ONLY)`);
  await conn.query(`USE ${alias}.main`);
}

// Attach a DuckDB file backed by an OPFS FileSystemFileHandle. Used at startup
// when a previously-picked file has been persisted to OPFS, so the user gets
// "remembers your DB" UX without re-picking on every reload. Mounted
// read-write — writes flow through DuckDB back to the OPFS-backed file, so
// edits persist across reloads automatically.
export async function attachOpfsHandle(
  handle: FileSystemFileHandle,
  alias = "gene",
): Promise<void> {
  const db = await bootDuckDB();
  await db.registerFileHandle(
    alias,
    handle,
    duckdb.DuckDBDataProtocol.BROWSER_FSACCESS,
    true,
  );
  await resetConn();
  const conn = await getConn();
  await conn.query(`ATTACH '${alias}' AS ${alias}`);
  await conn.query(`USE ${alias}.main`);
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") {
    // BigInts outside Number's safe range lose precision when coerced.
    // For our schema (positions, counts, ranks) this never happens, but
    // fall back to a string for any value that would lose precision.
    if (v > Number.MAX_SAFE_INTEGER || v < Number.MIN_SAFE_INTEGER) {
      return v.toString();
    }
    return Number(v);
  }
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const k in row) {
    row[k] = normalizeValue(row[k]);
  }
  return row;
}

function rewriteParams(sql: string, params: unknown[] | undefined): string {
  // duckdb-wasm's prepared statement API works, but for our SQL builders the
  // simpler path is inlining literals (with proper escaping) since the SQL
  // strings are static and we control the inputs.
  if (!params || params.length === 0) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => {
    const p = params[i++];
    if (p === null || p === undefined) return "NULL";
    if (typeof p === "number") return Number.isFinite(p) ? String(p) : "NULL";
    if (typeof p === "boolean") return p ? "TRUE" : "FALSE";
    // Strings: single-quote-escape
    return `'${String(p).replace(/'/g, "''")}'`;
  });
}

export class DuckDBWasmDataSource implements DataSource {
  capabilities: DataSourceCapabilities = {
    canWrite: true,
    canRunPipeline: false, // Phase 1c — JS port of transform DSL + scoring
    persistence: "opfs",
    label: "Local DuckDB",
  };

  async query<T = Row>(q: SqlQuery): Promise<T[]> {
    const conn = await getConn();
    const sql = rewriteParams(q.sql, q.params);
    const result = await conn.query(sql);
    // Arrow → plain objects. BIGINT columns come through as JS BigInt, which
    // breaks consumers doing arithmetic (a.pos - b.pos) or JSON.stringify.
    // Genomic positions, counts, and ranks are all well under MAX_SAFE_INTEGER,
    // so coercing to Number is safe and matches the REST adapter's shape.
    return result.toArray().map((r) => normalizeRow({ ...r })) as T[];
  }

  async exec(q: SqlQuery): Promise<void> {
    const conn = await getConn();
    const sql = rewriteParams(q.sql, q.params);
    await conn.query(sql);
  }
}
