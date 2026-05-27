// Landing / home for the redesigned IA — shown at index ("/") once a DB is
// attached (the pre-attach gate is still SplashPage). Search-first landing:
// branding (top-aligned) + unified search (routes to Explore). Content below
// the search is TBD.

import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";

const EXAMPLES = ["FAM13A", "rs7671167", "FEV1"];

export function LandingPage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
  };

  return (
    <div className="px-6 pt-28 pb-20">
      <div className="max-w-3xl mx-auto flex flex-col items-center">
        <h1 className="text-6xl font-thin tracking-wide mb-6">
          <span className="text-primary font-[250]">pegasus</span>
          <span className="text-base-content/30">.</span>
          <span className="text-base-content/50 font-thin">v2f</span>
        </h1>
        <p className="text-base font-normal text-base-content/50 text-center max-w-2xl mb-12">
          A workspace for building, exploring, and sharing variant-to-function evidence.
        </p>

        <form
          onSubmit={submit}
          className="w-full max-w-xl flex items-center gap-2 border border-primary/30 rounded-lg px-3 py-2.5"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for genes, loci, traits, studies…"
            className="flex-1 bg-transparent outline-none text-sm text-base-content placeholder:text-base-content/50"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="w-7 h-7 rounded-full bg-primary text-primary-content hover:bg-primary/90 transition-colors flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowRight size={14} />
          </button>
        </form>

        <div className="flex items-center gap-1.5 mt-4 flex-wrap justify-center">
          <span className="text-base-content/30 text-xs">Try:</span>
          {EXAMPLES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => navigate(`/explore?q=${encodeURIComponent(term)}`)}
              className="text-xs px-2.5 py-1 rounded-full border border-base-300 text-base-content/50 hover:text-base-content hover:border-base-content/30 transition-colors cursor-pointer"
            >
              {term}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
