import { Routes, Route, Navigate } from "react-router";
import { LandingPage } from "./pages/landing";
import { SourcesPage } from "./pages/sources";
import { ExplorePage } from "./pages/explore";
import { LociList } from "./pages/explore/loci-list";
import { GenesList } from "./pages/explore/genes-list";
import { TraitsList } from "./pages/explore/traits-list";
import { DetailStub } from "./pages/explore/detail-stub";
import { TraitDetailPage } from "./pages/explore/trait-detail";
import { DatabasePage } from "./pages/database";

// Redesigned IA: a landing/home at index, plus the three main surfaces
// (Sources · Explore · Database). The old IA's pages (traits/genes/config/
// query/settings/sources-catalog) remain in src/pages for porting but are no
// longer routed.
//
// Explore is a nested route: the shell (entity sub-nav + Outlet) wraps the
// four browse lists; detail routes use a stub until those slices land.
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<LandingPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="explore" element={<ExplorePage />}>
        <Route index element={<Navigate to="/explore/loci" replace />} />
        <Route path="loci" element={<LociList />} />
        <Route path="genes" element={<GenesList />} />
        <Route path="traits" element={<TraitsList />} />
      </Route>
      {/* Detail routes (stubs for now) — outside the browse shell. Study is
          not a browse entity: it's a proxy for a source-via-mapping, owned by
          the Sources tab; loci carry their source_tag for provenance. */}
      <Route path="explore/locus/:id" element={<DetailStub kind="locus" />} />
      <Route path="explore/gene/:symbol" element={<DetailStub kind="gene" />} />
      <Route path="explore/trait/:id" element={<TraitDetailPage />} />
      <Route path="database" element={<DatabasePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
