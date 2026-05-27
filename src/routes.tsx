import { Routes, Route, Navigate } from "react-router";
import { LandingPage } from "./pages/landing";
import { SourcesPage } from "./pages/sources";
import { ExplorePage } from "./pages/explore";
import { DatabasePage } from "./pages/database";

// Redesigned IA: a landing/home at index, plus the three main surfaces
// (Sources · Explore · Database). The old IA's pages (traits/genes/config/
// query/settings/sources-catalog) remain in src/pages for porting but are no
// longer routed.
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="explore" element={<ExplorePage />} />
      <Route path="database" element={<DatabasePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
