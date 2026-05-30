import { Routes, Route, Navigate } from "react-router";
import { LandingPage } from "./pages/landing";
import { SourcesPage } from "./pages/sources";
import { SearchPage } from "./pages/explore/search";
import { TraitsPage } from "./pages/traits";
import { LocusDetailPage } from "./pages/explore/locus-detail";
import { GeneDetailPage } from "./pages/explore/gene-detail";
import { DatabasePage } from "./pages/database";

// Redesigned IA: landing at index, then Search · Traits · Sources · Admin.
//   - Search: a search box → ranked gene/locus/trait results (no auto-jump).
//     gene/locus → detail pages; trait → Traits with it selected.
//   - Traits: trait sidebar + the selected trait's detail (genome track etc.).
//   - Detail pages (gene/locus) are standalone with a "Search / name"
//     breadcrumb. Trait detail has no standalone route — it lives in Traits.
//   - Admin: the DB file / sync / tables / SQL / activity / settings surface.
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="traits" element={<TraitsPage />} />
      <Route path="gene/:symbol" element={<GeneDetailPage />} />
      <Route path="locus/:id" element={<LocusDetailPage />} />
      <Route path="admin" element={<DatabasePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
