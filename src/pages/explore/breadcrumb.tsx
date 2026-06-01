// Static breadcrumb for detail pages: "Search / <kind> / <name>". The Search
// crumb links back to the search page (a fixed root, not history-accurate);
// `kind` (e.g. "Gene", "Locus") is a static, non-link label of what this is.

import { Link } from "react-router";

export function Breadcrumb({ kind, name }: { kind?: string; name: string }) {
  return (
    <nav className="text-xs text-base-content/40 flex items-center gap-1.5">
      <Link to="/search" className="text-primary hover:underline">
        Search
      </Link>
      <span>/</span>
      {kind && (
        <>
          <span className="text-base-content/50">{kind}</span>
          <span>/</span>
        </>
      )}
      <span className="font-mono text-base-content/60 truncate">{name}</span>
    </nav>
  );
}
