// Origin Private File System helpers for persisting the user's .duckdb
// across page loads. Uses a single canonical path; replacing the picked file
// just overwrites the contents. Phase 1c can extend to multiple named slots.

const DIR = "duckdb";
const FILE = "current.duckdb";
const META_KEY = "pegasus-v2f.opfs.duckdb.meta";

export type DuckDBOpfsMeta = {
  name: string; // original filename, for display
  size: number;
  savedAt: number; // epoch ms
};

export function isOpfsAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

async function getRootHandle(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory();
}

async function getDirHandle(create = true): Promise<FileSystemDirectoryHandle> {
  const root = await getRootHandle();
  return await root.getDirectoryHandle(DIR, { create });
}

async function getFileHandle(create = true): Promise<FileSystemFileHandle> {
  const dir = await getDirHandle(create);
  return await dir.getFileHandle(FILE, { create });
}

export async function hasSavedDuckDB(): Promise<boolean> {
  // The localStorage meta marker is the authoritative "is there a saved DB"
  // signal. clearDuckDB() removes it first — so even if the OPFS file
  // deletion fails (e.g., still briefly locked by a just-terminated worker),
  // the next page load sees "no saved DB" and shows the splash.
  if (!getMeta()) return false;
  if (!isOpfsAvailable()) return false;
  try {
    const dir = await getDirHandle(false);
    await dir.getFileHandle(FILE);
    return true;
  } catch {
    return false;
  }
}

export async function getSavedHandle(): Promise<FileSystemFileHandle | null> {
  if (!isOpfsAvailable()) return null;
  try {
    return await getFileHandle(false);
  } catch {
    return null;
  }
}

export async function saveDuckDB(file: File): Promise<void> {
  if (!isOpfsAvailable()) {
    throw new Error("OPFS not available in this browser");
  }
  const handle = await getFileHandle(true);
  const writable = await handle.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
  const meta: DuckDBOpfsMeta = {
    name: file.name,
    size: file.size,
    savedAt: Date.now(),
  };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }
}

export async function clearDuckDB(): Promise<void> {
  // Remove the meta marker FIRST — that's what hasSavedDuckDB checks. If the
  // OPFS file removal then fails (e.g., the worker hasn't fully released its
  // lock), the next page load still treats us as forgotten, and the next
  // attachDuckDBFile() will overwrite whatever stale bytes remain.
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(META_KEY);
  }
  if (!isOpfsAvailable()) return;
  try {
    const dir = await getDirHandle(false);
    await dir.removeEntry(FILE);
  } catch (err) {
    // NotFoundError = file wasn't there to begin with (forgotten earlier
    // or never created). That's not a problem — clearDuckDB is
    // idempotent. Anything else (NoModificationAllowedError when the
    // worker still holds a lock, etc.) is worth a warning since the
    // next attach will end up overwriting stale bytes.
    const name = (err as { name?: string } | null)?.name;
    if (name === "NotFoundError") return;
    console.warn(
      "clearDuckDB: failed to remove OPFS file (likely still locked); will be overwritten on next attach.",
      err,
    );
  }
}

export function getMeta(): DuckDBOpfsMeta | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DuckDBOpfsMeta;
  } catch {
    return null;
  }
}
