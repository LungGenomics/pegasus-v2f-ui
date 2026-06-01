// Landing / home for the redesigned IA, shown at index ("/") once a DB is
// attached (boot loads shared-or-blank automatically). Search-first hero
// (branding + unified search into Explore), then an About section: 3 concept
// cards (Variant→Function, PEGASUS-based model, Build/explore/share) that each
// open a detail panel below the row.

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
    blurb: "Evidence that links a trait's loci to their candidate genes.",
  },
  {
    title: "A PEGASUS-based model",
    blurb: "The schema follows the PEGASUS standard and its evidence categories.",
  },
  {
    title: "Build, explore, share",
    blurb: "Runs in your browser on DuckDB-WASM, published and pulled via Cloudflare.",
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
          Genome-wide association studies link genomic regions to traits, but
          not the genes that drive them. pegasus.v2f organizes the genetic and
          functional evidence that closes this variant-to-function gap. A
          trait's association signals are clustered into{" "}
          <span className="font-medium">loci</span>, the genes overlapping a
          locus become its{" "}
          <span className="font-medium">candidate genes</span>, and evidence
          attaches to each by genomic position or by gene.
        </p>
        <p>
          The goal is to explore the evidence neighborhood around a locus,
          meaning its candidate genes and the lines of evidence implicating
          them, rather than to name a single causal gene. That choice is
          deliberate. It surfaces the full picture and leaves the judgment to
          you.
        </p>
      </div>
    </div>
  );
}

function CategoriesDetail() {
  const entries = Object.entries(EVIDENCE_CATEGORIES);
  return (
    <div>
      <DetailHeading>A PEGASUS-based model</DetailHeading>
      <div className="space-y-3 text-sm text-base-content/60 leading-relaxed max-w-3xl mb-5">
        <p>
          The schema follows the <span className="font-medium">PEGASUS
          standard</span>, an effort from EMBL-EBI and the Broad Institute to
          standardize how predicted effector genes are reported. At its core is
          an evidence matrix that links variants, loci, and genes to their
          supporting evidence, so that conclusions drawn in one study can be
          compared and reused in another.
        </p>
        <p>
          Every piece of evidence is tagged with one of PEGASUS's 22 categories.
          The categories are grouped as{" "}
          <span className="font-medium">variant-centric</span> (such as GWAS
          association, molecular QTL, colocalization, and finemapping),{" "}
          <span className="font-medium">gene-centric</span> (such as expression,
          perturbation, and drug targets), or applicable to either. That same
          grouping decides how a piece of evidence attaches to a locus in
          pegasus.v2f: variant-centric evidence by position, gene-centric by
          gene.
        </p>
        <p>
          pegasus.v2f adds a per-category score on top of the standard,
          capturing not just what kind of support a gene has but how strong it
          is. Reading across a gene's categories then gives a sense of breadth,
          and a gene backed by several independent lines of evidence ranks above
          one resting on a single line.
        </p>
        <p>
          Learn more in the{" "}
          <a
            href="https://ebispot.github.io/PEGASUS/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            PEGASUS standard documentation
          </a>
          .
        </p>
      </div>
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
      <DetailHeading>Build, explore, share</DetailHeading>
      <div className="space-y-3 text-sm text-base-content/60 leading-relaxed">
        <p>
          The whole database runs in your browser on{" "}
          <span className="font-medium">DuckDB-WASM</span>, with no server
          involved. Add sources, map their columns to the PEGASUS schema, and
          the loci and evidence build locally and instantly. The database
          persists on your machine across sessions and works offline.
        </p>
        <p>
          Reading uses public access. To{" "}
          <span className="font-medium">publish</span>, sign in with GitHub:
          approved editors push one canonical copy of the database to a shared
          store, and anyone with access can{" "}
          <span className="font-medium">pull</span> the latest to stay in sync.
          The database file lives in a Cloudflare R2 bucket, with a Worker
          handling sign-in and edit locks. Build in Sources, explore traits,
          genes, and loci, then hand the same database to a collaborator.
        </p>
      </div>
    </div>
  );
}
