// Landing / home for the redesigned IA — shown at index ("/") once a DB is
// attached (boot loads shared-or-blank automatically). Search-first hero
// (branding + unified search → Explore), then an About section: 3 concept
// cards that expand a detail panel below the row.

import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { EVIDENCE_CATEGORIES } from "../data/static";
import { CATEGORY_HUES } from "../components/locus-detail-pane/evidence-heatmap";
import { landingStats } from "../data/queries/explore";

const EXAMPLES = ["FAM13A", "rs7671167", "FEV1"];

export function LandingPage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const statsQ = useQuery({ queryKey: ["landing-stats"], queryFn: landingStats });
  const stats = statsQ.data;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="px-6 pt-32 pb-20">
      <div className="max-w-3xl mx-auto flex flex-col items-center">
        <h1 className="text-6xl font-thin tracking-wide mb-6">
          <span className="text-primary font-[250]">pegasus</span>
          <span className="text-base-content/30">.</span>
          <span className="text-base-content/50 font-thin">v2f</span>
        </h1>
        <p className="text-base font-normal text-base-content/50 text-center max-w-2xl mb-16">
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

        <div className="flex items-center gap-1.5 mt-6 flex-wrap justify-center">
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

        {stats && (
          <p className="mt-16 text-sm text-base-content/40 flex items-center gap-2 flex-wrap justify-center">
            <span>{stats.traits.toLocaleString()} traits</span>
            <span className="text-base-content/20">·</span>
            <span>{stats.studies.toLocaleString()} studies</span>
            <span className="text-base-content/20">·</span>
            <span>{stats.loci.toLocaleString()} loci</span>
            <span className="text-base-content/20">·</span>
            <span className="font-mono">{stats.genomeBuild}</span>
          </p>
        )}
      </div>

      <AboutSection />
    </div>
  );
}

// --- About section: 3 concept cards → expandable detail panel ---

const CARDS = [
  {
    title: "Variant → Function",
    blurb: "Aggregating evidence that links variants and loci to candidate genes.",
  },
  {
    title: "PEGASUS evidence",
    blurb: "A standard vocabulary of 22 evidence categories.",
  },
  {
    title: "In-browser",
    blurb: "Runs entirely in your browser — DuckDB-WASM + Cloudflare.",
  },
] as const;

function AboutSection() {
  // One card is always open (default the first). Clicking selects; there's no
  // closed state.
  const [active, setActive] = useState(0);

  return (
    <div className="max-w-5xl mx-auto mt-24">
      <div className="grid sm:grid-cols-3 gap-4">
        {CARDS.map((c, i) => {
          const isActive = active === i;
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => setActive(i)}
              className={`text-left rounded-lg border p-4 transition-colors cursor-pointer ${
                isActive
                  ? "border-primary/50 bg-primary/5"
                  : "border-base-300 hover:border-base-content/30"
              }`}
            >
              <h3 className="text-sm font-semibold">{c.title}</h3>
              <p className="text-xs text-base-content/50 leading-relaxed mt-1.5">
                {c.blurb}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-base-300 bg-base-100 p-6">
        {active === 0 && <VariantToFunctionDetail />}
        {active === 1 && <CategoriesDetail />}
        {active === 2 && <ArchitectureDetail />}
      </div>
    </div>
  );
}

function DetailHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="text-base font-semibold mb-3">{children}</h4>;
}

function VariantToFunctionDetail() {
  return (
    <div className="max-w-3xl">
      <DetailHeading>Variant → Function</DetailHeading>
      <div className="space-y-3 text-sm text-base-content/60 leading-relaxed">
        <p>
          pegasus.v2f organizes the genetic and functional evidence that links
          variants to the genes they likely act through. Association signals
          (variants) are clustered into <span className="font-medium">loci</span>{" "}
          by genomic window and merge distance; the genes overlapping a locus's
          window become its <span className="font-medium">candidate genes</span>,
          and evidence — GWAS, QTL, colocalization, and the rest — attaches to a
          locus by position or by gene.
        </p>
        <p>
          The deliverable is to <span className="font-medium">explore the
          evidence neighborhood around a locus</span> — the candidate genes and
          the lines of evidence implicating them — rather than a single
          predicted causal gene. That call is deliberate: it surfaces the full
          evidence picture and leaves the judgment to you.
        </p>
      </div>
    </div>
  );
}

function CategoriesDetail() {
  const entries = Object.entries(EVIDENCE_CATEGORIES);
  return (
    <div>
      <DetailHeading>PEGASUS evidence categories</DetailHeading>
      <p className="text-sm text-base-content/60 leading-relaxed mb-4 max-w-3xl">
        Every piece of evidence is tagged with one of the PEGASUS standard
        categories. The colors match what you see across Explore.
      </p>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5">
        {entries.map(([code, label]) => (
          <div key={code} className="flex items-center gap-2 text-sm">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                backgroundColor: `hsla(${CATEGORY_HUES[code] ?? "0"}, 70%, 50%, 0.7)`,
              }}
            />
            <span className="font-mono font-medium w-20 shrink-0">{code}</span>
            <span className="text-base-content/60 truncate">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchitectureDetail() {
  return (
    <div className="max-w-3xl">
      <DetailHeading>In-browser: DuckDB + Cloudflare</DetailHeading>
      <div className="space-y-3 text-sm text-base-content/60 leading-relaxed">
        <p>
          The whole database runs in your browser. Queries execute locally
          against <span className="font-medium">DuckDB-WASM</span> — there's no
          API server — and the database is a single DuckDB file persisted on
          your machine (OPFS), so building and exploring are instant and
          offline-capable.
        </p>
        <p>
          Sharing rides on <span className="font-medium">Cloudflare</span>: the
          database file is published to and pulled from an R2 bucket
          (public-read), with a Worker handling GitHub sign-in and edit locks.
          The hg38 gene reference is a parquet on the same bucket, read on
          demand. Build a database in Sources, explore it live, and publish to
          share it with the team.
        </p>
      </div>
    </div>
  );
}
