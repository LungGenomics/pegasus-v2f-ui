import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Navbar } from "./components/layout/navbar";
import { AppRoutes } from "./routes";
import { SplashPage } from "./pages/splash";
import {
  initDataSource,
  isAttached,
  subscribeDataSource,
} from "./data/select";
import { captureSyncRedirect } from "./data/syncClient";

export function App() {
  const [booted, setBooted] = useState(false);
  const [attached, setAttached] = useState(isAttached());
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    // Consume the post-OAuth #sync_token/#sync_error fragment before
    // anything else (it scrubs the hash so creds don't linger).
    const { error } = captureSyncRedirect();
    if (error) setSyncError(error);
    let cancelled = false;
    initDataSource()
      .catch((err) => console.error("DataSource init failed:", err))
      .finally(() => {
        if (!cancelled) {
          setAttached(isAttached());
          setBooted(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => subscribeDataSource(() => setAttached(isAttached())),
    [],
  );

  const location = useLocation();
  // New IA pages are all workspace-style (full width). Landing manages its
  // own centered layout, so it gets no padding.
  const isLanding = location.pathname === "/";

  if (!booted) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="text-sm text-base-content/60">Loading…</div>
      </div>
    );
  }

  if (!attached) {
    return <SplashPage />;
  }

  return (
    <div className="min-h-screen bg-base-100">
      <Navbar />
      {syncError && (
        <div
          role="alert"
          className="alert alert-error rounded-none text-sm py-2 flex"
        >
          <span className="flex-1">Sync sign-in rejected: {syncError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setSyncError(null)}
          >
            dismiss
          </button>
        </div>
      )}
      <main className={isLanding ? "" : "px-6 py-6"}>
        <AppRoutes />
      </main>
    </div>
  );
}
