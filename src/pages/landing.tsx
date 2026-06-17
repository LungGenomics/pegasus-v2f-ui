// Landing / home for the redesigned IA, shown at index ("/") once a DB is
// attached (boot loads shared-or-blank automatically). Search-first hero
// (branding + unified search into Explore), then two summary tables — Traits
// and Sources — each linking into its browse/detail surface.

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { listTraits } from "../data/queries/explore";
import { listSources } from "../data/sourceOps";
import { formatNumber } from "../lib/format";

const EXAMPLES = ["TGFB2", "SERPINA1", "FEV1"];

export function LandingPage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="px-6 pt-[5.5rem] pb-20">
      <div className="max-w-3xl mx-auto flex flex-col items-center">
        <h1 className="text-3xl font-thin tracking-wide">
          <span className="text-primary font-normal">pegasus</span>
          <span className="text-base-content/30">.</span>
          <span className="text-base-content/50 font-thin">v2f</span>
        </h1>
        <p className="text-[0.9375rem] font-normal text-base-content/50 text-center max-w-2xl mt-1 mb-16">
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
            placeholder="Search for genes, loci, or traits…"
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

        <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center">
          <span className="text-base-content/30 text-xs">Try:</span>
          {EXAMPLES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => navigate(`/search?q=${encodeURIComponent(term)}`)}
              className="text-xs px-2.5 py-1 rounded-full border border-base-300 text-base-content/50 hover:text-base-content hover:border-base-content/30 transition-colors cursor-pointer"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      <SummarySection />
    </div>
  );
}

// --- Summary tables (drumbeat-atlas landing pattern): two bordered lists below
// the search — the trait catalog and the sources behind it. Each header shows
// the total count; each row links into its detail surface, and the "all" link
// opens the full browse page. ---


function SummarySection() {
  return (
    <div className="max-w-3xl mx-auto mt-16 grid gap-6 sm:grid-cols-2">
      <TraitsSummary />
      <SourcesSummary />
    </div>
  );
}

/** Titled card: muted heading with an optional total count + right-aligned
 * "all" link, then the body. */
function CardShell({
  title,
  count,
  allTo,
  children,
}: {
  title: string;
  count?: number;
  allTo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-base-content/60">
          {title}
          {count != null && (
            <span className="ml-2 font-normal tabular-nums text-base-content/30">
              {formatNumber(count)}
            </span>
          )}
        </h2>
        {allTo && (
          <Link to={allTo} className="text-xs text-primary hover:underline">
            all
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Bordered list wrapper with divided rows. Caps at ~7 rows tall and scrolls
 *  internally for the full list. */
function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-base-300 max-h-64 overflow-y-auto rounded-lg border border-base-300 text-sm">
      {children}
    </div>
  );
}

function Row({
  to,
  left,
  right,
}: {
  to?: string;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const body = (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0 truncate text-base-content/70">{left}</span>
      <span className="shrink-0 text-base-content/40 tabular-nums">{right}</span>
    </div>
  );
  return to ? (
    <Link to={to} className="block transition-colors hover:bg-base-200/50">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Single-line placeholder used for the loading / empty / error states so the
 * card keeps its shape before data arrives. */
function StateLine({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-base-300 px-3 py-6 text-center text-sm text-base-content/40">
      {text}
    </p>
  );
}

function TraitsSummary() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-traits"],
    queryFn: listTraits,
  });
  return (
    <CardShell title="Traits" count={data?.length} allTo="/traits">
      {isLoading ? (
        <StateLine text="Loading…" />
      ) : error ? (
        <StateLine text="Failed to load." />
      ) : !data || data.length === 0 ? (
        <StateLine text="No traits yet." />
      ) : (
        <List>
          {data.map((t) => (
            <Row
              key={t.trait_id}
              to={`/traits?trait=${encodeURIComponent(t.trait_id)}`}
              left={t.label}
              right={formatNumber(t.n_loci)}
            />
          ))}
        </List>
      )}
    </CardShell>
  );
}

function SourcesSummary() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-sources"],
    queryFn: listSources,
  });
  return (
    <CardShell title="Sources" count={data?.length} allTo="/sources">
      {isLoading ? (
        <StateLine text="Loading…" />
      ) : error ? (
        <StateLine text="Failed to load." />
      ) : !data || data.length === 0 ? (
        <StateLine text="No sources yet." />
      ) : (
        <List>
          {data.map((s) => (
            <Row
              key={s.id}
              to={`/sources?source=${encodeURIComponent(s.name)}`}
              left={s.name}
              right={
                <span className="font-mono text-xs">{s.source_type}</span>
              }
            />
          ))}
        </List>
      )}
    </CardShell>
  );
}
