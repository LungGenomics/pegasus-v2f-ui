// React-side accessor for the GitHub sign-in session held in localStorage by
// syncClient.ts. Re-reads on `storage` events so signing in/out in another tab
// propagates here, and on a custom `pv2f-session` event so same-tab sign-out
// triggers a re-render too (storage events don't fire in the originating tab).

import { useEffect, useState } from "react";
import { getSyncSession, type SyncSession } from "../data/syncClient";

export const SESSION_EVENT = "pv2f-session";

/** Notify all `useSyncSession` consumers that the session changed. Call after
 *  `signOut()` (or anywhere we mutate the session in the same tab). */
export function emitSessionChange(): void {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function useSyncSession(): SyncSession | null {
  const [session, setSession] = useState<SyncSession | null>(() =>
    getSyncSession(),
  );
  useEffect(() => {
    const refresh = () => setSession(getSyncSession());
    window.addEventListener("storage", refresh);
    window.addEventListener(SESSION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SESSION_EVENT, refresh);
    };
  }, []);
  return session;
}
