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
  const auth = { Authorization: `Bearer ${sess.token}` };

  const presignRes = await fetch(`${SYNC_BASE}/db/presign`, {
    method: "POST",
    headers: auth,
  });
  if (presignRes.status === 401) {
    clearSessionAnd("Sync session expired — sign in again.");
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
    body: JSON.stringify({ key }),
  });
  if (commitRes.status === 401) {
    clearSessionAnd("Sync session expired — sign in again.");
  }
  if (!commitRes.ok) {
    throw new Error(
      `commit failed (${commitRes.status} ${await commitRes
        .text()
        .catch(() => "")})`,
    );
  }
  const { latest } = (await commitRes.json()) as {
    latest: { current_key: string; published_at: string };
  };
  return { current_key: latest.current_key, published_at: latest.published_at };
}
