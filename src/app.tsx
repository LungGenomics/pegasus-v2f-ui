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

export function App() {
  const [booted, setBooted] = useState(false);
  const [attached, setAttached] = useState(isAttached());

  useEffect(() => {
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
  const isLanding = location.pathname === "/";
  const isFullWidth =
    isLanding ||
    location.pathname.startsWith("/sources") ||
    location.pathname.startsWith("/config");

  if (!booted) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-sm text-base-content/60">Loading…</div>
      </div>
    );
  }

  if (!attached) {
    return <SplashPage />;
  }

  return (
    <div className="min-h-screen bg-base-200">
      <Navbar />
      {isFullWidth ? (
        <main className={isLanding ? "" : "px-6 py-6"}>
          <AppRoutes />
        </main>
      ) : (
        <main className="container mx-auto px-4 py-6">
          <AppRoutes />
        </main>
      )}
    </div>
  );
}
