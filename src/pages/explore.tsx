// Explore tab (redesign) — placeholder. The read side: a unified polymorphic
// search (gene / locus / chr:pos / rsID / trait / study) → conventional list
// results → detail pages you traverse one hop at a time. Genome track lives
// on positional detail pages, not here.

import { Search } from "lucide-react";

export function ExplorePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold mb-1">Explore</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Search loci, genes, traits, and studies across the live database, then
        drill into detail pages and traverse related entities.
      </p>

      <div className="relative mb-6">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
        <input
          disabled
          className="input input-bordered w-full pl-9"
          placeholder="Search a gene, locus, region (chr:start-end), rsID, trait, or study…"
        />
      </div>

      <div className="border border-dashed border-base-300 rounded-lg p-10 text-center text-sm text-base-content/40">
        Placeholder — unified search results (list) and detail pages go here.
      </div>
    </div>
  );
}
