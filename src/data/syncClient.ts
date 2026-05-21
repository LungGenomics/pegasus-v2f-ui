// Client for the pegasus-v2f-sync Worker (Phase 5).
//
// Auth is a signed bearer token the Worker hands back via a redirect
// fragment (#sync_token=…&login=…) — not a cross-site cookie — so
// localhost ↔ workers.dev works. Publish is: presign → browser PUTs
// the DB bytes straight to R2 (Worker not in the data path) → commit
// advances latest.json. On success the caller snapshots the dirty
// tracker so local edits read clean.

const SYNC_BASE = (
  (import.meta.env as Record<string, string | undefined>).VITE_SYNC_BASE ??
  "https://pegasus-v2f-sync.sanghoonio.workers.dev"
).replace(/\/+$/, "");

const TOKEN_KEY = "pv2f_sync_token";
const LOGIN_KEY = "pv2f_sync_login";
const LEASE_KEY = "pv2f_sync_lease"; // sessionStorage — ephemeral by design

export interface SyncSession {
  login: string;
  token: string;
}

/** Read the post-OAuth redirect fragment once on app load: store the
 *  token or surface the allowlist/error message, then scrub the hash
 *  so it doesn't linger in the URL / history. Returns a transient
 *  error string to show the user, if any. */
export function captureSyncRedirect(): { error?: string } {
  const h = window.location.hash;
  if (!h || (!h.includes("sync_token=") && !h.includes("sync_error="))) {
    return {};
  }
  const params = new URLSearchParams(h.replace(/^#/, ""));
  const token = params.get("sync_token");
  const login = params.get("login");
  const error = params.get("sync_error");
  if (token && login) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LOGIN_KEY, login);
  }
  // Strip the fragment regardless so credentials don't sit in the URL.
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return error ? { error } : {};
}

export function getSyncSession(): SyncSession | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const login = localStorage.getItem(LOGIN_KEY);
  return token && login ? { login, token } : null;
}

export function signIn(): void {
  window.location.href = `${SYNC_BASE}/auth/login`;
}

export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LOGIN_KEY);
  sessionStorage.removeItem(LEASE_KEY);
}

// --- Lock / lease (Phase C v1, heartbeat-less; lock auto-expires) ----

export interface Lease {
  lease_token: string;
  login: string;
  expires_at: number;
}
export interface LockHolder {
  login: string;
  acquired_at: number;
  expires_at: number;
}

export function getLease(): Lease | null {
  const raw = sessionStorage.getItem(LEASE_KEY);
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Lease;
    if (l.expires_at < Date.now()) {
      sessionStorage.removeItem(LEASE_KEY);
      return null;
    }
    return l;
  } catch {
    return null;
  }
}
function setLease(l: Lease): void {
  sessionStorage.setItem(LEASE_KEY, JSON.stringify(l));
}
function clearLease(): void {
  sessionStorage.removeItem(LEASE_KEY);
}

export async function fetchLockHolder(): Promise<LockHolder | null> {
  const r = await fetch(`${SYNC_BASE}/db/lock`, { cache: "no-store" });
  if (!r.ok) throw new Error(`/db/lock GET failed (${r.status})`);
  const j = (await r.json()) as { holder: LockHolder | null };
  return j.holder ?? null;
}

export async function acquireLock(): Promise<Lease> {
  const sess = getSyncSession();
  if (!sess) throw new Error("Not signed in.");
  const r = await fetch(`${SYNC_BASE}/db/lock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sess.token}` },
  });
  if (r.status === 401) clearSessionAnd("Sync session expired — sign in again.");
  if (r.status === 423) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "locked by someone else");
  }
  if (!r.ok) {
    throw new Error(`acquireLock failed (${r.status})`);
  }
  const lease = (await r.json()) as Lease;
  setLease(lease);
  return lease;
}

export async function heartbeatLock(): Promise<Lease> {
  const sess = getSyncSession();
  const lease = getLease();
  if (!sess) throw new Error("Not signed in.");
  if (!lease) throw new Error("No lease to heartbeat.");
  const r = await fetch(`${SYNC_BASE}/db/lock/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sess.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ lease_token: lease.lease_token }),
  });
  if (r.status === 401) clearSessionAnd("Sync session expired — sign in again.");
  if (r.status === 423) {
    clearLease();
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "lease lost; re-acquire to publish");
  }
  if (!r.ok) throw new Error(`heartbeat failed (${r.status})`);
  const { expires_at } = (await r.json()) as { expires_at: number };
  const next: Lease = { ...lease, expires_at };
  setLease(next);
  return next;
}

export async function releaseLock(): Promise<void> {
  const sess = getSyncSession();
  const lease = getLease();
  if (!sess || !lease) {
    clearLease();
    return;
  }
  await fetch(`${SYNC_BASE}/db/lock`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${sess.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ lease_token: lease.lease_token }),
  }).catch(() => {
    /* best-effort; the lock will TTL out regardless */
  });
  clearLease();
}

function clearSessionAnd(msg: string): never {
  signOut();
  throw new Error(msg);
}

export interface SyncInfo {
  current_key: string | null;
  published_by?: string;
  published_at?: string;
}

export async function fetchSyncInfo(): Promise<SyncInfo> {
  const r = await fetch(`${SYNC_BASE}/db/info`, { cache: "no-store" });
  if (!r.ok) throw new Error(`/db/info failed (${r.status})`);
  return (await r.json()) as SyncInfo;
}

interface PresignResponse {
  key: string;
  uploadUrl: string;
  publicUrl: string;
}

export interface PublishResult {
  current_key: string;
  published_at: string;
}

/** Full publish: presign → PUT bytes to R2 → commit pointer. The
 *  caller is responsible for snapshotting the dirty tracker on the
 *  returned key so local state reads clean afterward. */
export async function publish(bytes: Uint8Array): Promise<PublishResult> {
  const sess = getSyncSession();
  if (!sess) throw new Error("Not signed in.");
  const lease = getLease();
  if (!lease) {
    throw new Error("No editing lock — acquire one before publishing.");
  }
  const auth = { Authorization: `Bearer ${sess.token}` };

  const presignRes = await fetch(`${SYNC_BASE}/db/presign`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ lease_token: lease.lease_token }),
  });
  if (presignRes.status === 401) {
    clearSessionAnd("Sync session expired — sign in again.");
  }
  if (presignRes.status === 423) {
    const j = (await presignRes.json().catch(() => ({}))) as { error?: string };
    clearLease();
    throw new Error(j.error ?? "lock lost; re-acquire to publish");
  }
  if (!presignRes.ok) {
    throw new Error(`presign failed (${presignRes.status})`);
  }
  const { key, uploadUrl } = (await presignRes.json()) as PresignResponse;

  // Direct browser → R2 PUT. The presigned URL signs only `host`, so
  // an unsigned content-type is fine. Send a fresh ArrayBuffer slice
  // (some fetch impls dislike a SharedArrayBuffer-backed view).
  const put = await fetch(uploadUrl, {
    method: "PUT",
    body: bytes.slice().buffer,
    headers: { "content-type": "application/octet-stream" },
  });
  if (!put.ok) {
    throw new Error(
      `R2 upload failed (${put.status} ${await put.text().catch(() => "")})`,
    );
  }

  const commitRes = await fetch(`${SYNC_BASE}/db/commit`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ key, lease_token: lease.lease_token }),
  });
  if (commitRes.status === 401) {
    clearSessionAnd("Sync session expired — sign in again.");
  }
  if (commitRes.status === 423) {
    const j = (await commitRes.json().catch(() => ({}))) as { error?: string };
    clearLease();
    throw new Error(j.error ?? "lock lost; re-acquire to publish");
  }
  if (!commitRes.ok) {
    throw new Error(
      `commit failed (${commitRes.status} ${await commitRes
        .text()
        .catch(() => "")})`,
    );
  }
  // Worker releases the lock on successful commit; clear locally so
  // the UI doesn't keep thinking we hold it.
  clearLease();
  const { latest } = (await commitRes.json()) as {
    latest: { current_key: string; published_at: string };
  };
  return { current_key: latest.current_key, published_at: latest.published_at };
}
