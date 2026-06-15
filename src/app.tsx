import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { RotateCw } from "lucide-react";
import { Navbar } from "./components/layout/navbar";
import { Footer } from "./components/layout/footer";
import { AppRoutes } from "./routes";
import {
  initDataSource,
  isAttached,
  subscribeDataSource,
  loadSharedDuckDB,
  createNewDuckDB,
  subscribeBootProgress,
  getBootProgress,
} from "./data/select";
import { hasSavedDuckDB } from "./data/opfs";
import { captureSyncRedirect } from "./data/syncClient";
import { isSupportedBrowser } from "./lib/browser-support";
import { UnsupportedBrowser } from "./components/unsupported-browser";

// Boot: use the cached DB if there is one; otherwise pull the shared DB from
// R2; if there's no shared DB (or it errors), start a blank one. The app is
// always attached after boot — no drop-a-file splash.
//
// Critical: the shared/blank fallback (createNewDuckDB CLEARS OPFS) must run
// ONLY when there's genuinely no saved DB. If a saved DB exists but failed to
// attach (e.g. a transient OPFS lock), we must NOT nuke it — surface a
// reload prompt instead. Returns a boot error string, or null on success.
//
// Singleton: StrictMode double-invokes the boot effect in dev. Two concurrent
// createNewDuckDB() calls would race on the OPFS file and self-deadlock
// (createWritable → NoModificationAllowedError), so boot must run exactly once.
let _bootPromise: Promise<string | null> | null = null;
function bootDb(): Promise<string | null> {
  return (_bootPromise ??= bootDbOnce());
}

async function bootDbOnce(): Promise<string | null> {
  try {
    await initDataSource();
  } catch (err) {
    console.error("DataSource init failed:", err);
  }
  if (isAttached()) return null;

  // A saved DB exists but didn't attach → don't destroy it; reload usually
  // clears the transient OPFS lock.
  if (await hasSavedDuckDB()) {
    return "Your saved database is locked (another tab or a stale worker). Reload to retry.";
  }

  // No cached DB → pull shared, else start blank (nothing to lose).
  try {
    await loadSharedDuckDB();
    return null;
  } catch (err) {
    console.warn("No shared database to load — starting blank.", err);
  }
  try {
    await createNewDuckDB();
    return null;
  } catch (err) {
    console.error("Could not create a blank database:", err);
    return err instanceof Error ? err.message : String(err);
  }
}

// Detected once at module load — the browser can't change within a session.
const SUPPORTED = isSupportedBrowser();

export function App() {
  const [booted, setBooted] = useState(false);
  const [attached, setAttached] = useState(isAttached());
  const [bootError, setBootError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const bootProgress = useSyncExternalStore(
    subscribeBootProgress,
    getBootProgress,
    getBootProgress,
  );

  useEffect(() => {
    // Unsupported browsers render the block screen and never boot the DB —
    // attaching DuckDB-WASM would just fail.
    if (!SUPPORTED) return;
    // Consume the post-OAuth #sync_token/#sync_error fragment before
    // anything else (it scrubs the hash so creds don't linger).
    const { error } = captureSyncRedirect();
    if (error) setSyncError(error);
    let cancelled = false;
    bootDb().then((bootErr) => {
      if (!cancelled) {
        setBootError(bootErr);
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

  if (!SUPPORTED) {
    return <UnsupportedBrowser />;
  }

  if (!booted) {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    const pct =
      bootProgress?.total != null && bootProgress.total > 0
        ? Math.round((bootProgress.loaded / bootProgress.total) * 100)
        : 0;
    const caption = bootProgress
      ? bootProgress.total
        ? `${mb(bootProgress.loaded)} / ${mb(bootProgress.total)} MB · ${pct}%`
        : `${mb(bootProgress.loaded)} MB`
      : "connecting to data…";
    return (
      <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center gap-4 bg-base-100/95 backdrop-blur-sm">
        <span className="text-sm font-medium text-base-content/80">
          Loading database…
        </span>
        <div className="flex flex-col items-center gap-1 w-72">
          <div className="h-1 w-full bg-base-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-[width]"
              // Width is data-driven (indeterminate downloads sit at 0).
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-base-content/50 tabular-nums">
            {caption}
          </span>
        </div>
      </div>
    );
  }

  if (!attached) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh gap-4 px-4 pb-16">
        <h1 className="text-xl font-light text-base-content">
          Could not initialize the database.
        </h1>
        {bootError && (
          <div className="bg-base-200/50 border border-base-300 rounded-lg px-4 py-3 max-w-lg w-full">
            <p className="text-xs font-mono text-base-content/50 break-words">
              {bootError}
            </p>
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          className="btn btn-sm btn-primary gap-1.5 rounded-full"
        >
          <RotateCw size={14} />
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-base-100">
      <Navbar />
      {syncError && (
        <div
          role="alert"
          className="alert alert-error rounded-none text-sm py-2 flex shrink-0"
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
      <main className={`flex-1 ${isLanding ? "" : "px-6 py-6"}`}>
        <AppRoutes />
      </main>
      <Footer />
    </div>
  );
}
