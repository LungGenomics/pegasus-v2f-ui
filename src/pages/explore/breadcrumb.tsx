// Static breadcrumb for detail pages: "Search / <name>". The Search crumb
// links back to the search page (not history-accurate — a fixed root).

import { Link } from "react-router";

export function Breadcrumb({ name }: { name: string }) {
  return (
    <nav className="text-xs text-base-content/40 flex items-center gap-1.5">
      <Link to="/search" className="text-primary hover:underline">
        Search
      </Link>
      <span>/</span>
      <span className="font-mono text-base-content/60 truncate">{name}</span>
    </nav>
  );
}
