// Placeholder for the entity detail pages (locus / gene / trait / study).
// Detail pages are a later Explore slice; for now the browse lists link here
// so routing + traversal wiring exists. Shows which entity + id was routed.

import { useParams, Link } from "react-router";

export function DetailStub({ kind }: { kind: string }) {
  const params = useParams();
  const id = params.id ?? params.symbol ?? params.tag ?? "";
  return (
    <div className="max-w-2xl">
      <Link to="/explore" className="text-xs text-primary hover:underline">
        ← Explore
      </Link>
      <h2 className="text-lg font-semibold mt-2 capitalize">{kind}</h2>
      <p className="text-sm font-mono text-base-content/60 mt-1">{id}</p>
      <div className="mt-6 border border-dashed border-base-300 rounded-lg p-10 text-center text-sm text-base-content/40">
        {kind} detail page — coming in a later slice.
      </div>
    </div>
  );
}
