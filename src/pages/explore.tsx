// Explore tab (redesign) — browse slice. The shell: a secondary entity
// sub-nav (Loci · Genes · Traits · Studies) + an <Outlet/> for the active
// browse list. Unified search + detail pages are later slices; for now rows
// link to detail stubs.

import { NavLink, Outlet } from "react-router";

const ENTITIES = [
  { to: "/explore/loci", label: "Loci" },
  { to: "/explore/genes", label: "Genes" },
  { to: "/explore/traits", label: "Traits" },
  { to: "/explore/studies", label: "Studies" },
];

export function ExplorePage() {
  return (
    <div className="h-[calc(100vh-6.25rem)] flex flex-col min-h-0">
      <div className="flex items-center gap-5 mb-4 shrink-0">
        {ENTITIES.map((e) => (
          <NavLink
            key={e.to}
            to={e.to}
            className={({ isActive }) =>
              `text-sm ${
                isActive
                  ? "text-primary font-medium"
                  : "text-base-content/60 hover:text-base-content"
              }`
            }
          >
            {e.label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
