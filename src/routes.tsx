import { Routes, Route, Navigate } from "react-router";
import { LandingPage } from "./pages/landing";
import { SourcesPage } from "./pages/sources";
import { SearchPage } from "./pages/explore/search";
import { BrowsePage } from "./pages/browse";
import { LocusDetailPage } from "./pages/explore/locus-detail";
import { GeneDetailPage } from "./pages/explore/gene-detail";
import { DatabasePage } from "./pages/database";

// Redesigned IA: landing at index, then Sources · Search · Browse · Admin.
//   - Search: a search box → ranked gene/locus/trait results (no auto-jump).
//     gene/locus → detail pages; trait → Browse with it selected.
//   - Browse: trait sidebar + the selected trait's detail (genome track etc.).
//   - Detail pages (gene/locus) are standalone with a "Search / name"
//     breadcrumb. Trait detail has no standalone route — it lives in Browse.
//   - Admin: the DB file / sync / tables / SQL / activity / settings surface.
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="browse" element={<BrowsePage />} />
      <Route path="gene/:symbol" element={<GeneDetailPage />} />
      <Route path="locus/:id" element={<LocusDetailPage />} />
      <Route path="admin" element={<DatabasePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
