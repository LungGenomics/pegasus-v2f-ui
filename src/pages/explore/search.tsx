// Unified search results (/explore/search?q=…). Positional / exact inputs
// redirect straight to a detail page; everything else shows ONE fuzzy-ranked
// list across genes · loci · traits, each row tagged with its type (icon +
// label). The search box refines in place.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, Dna, MapPin, Activity } from "lucide-react";
import { jointSearch, type HitType } from "../../data/queries/search";

const TYPE_META: Record<
  HitType,
  {
    icon: typeof Dna;
    label: string;
    route: (k: string) => string;
    unit: string;
    unitOne: string;
  }
> = {
  gene: { icon: Dna, label: "gene", route: (k) => `/gene/${encodeURIComponent(k)}`, unit: "loci", unitOne: "locus" },
  locus: { icon: MapPin, label: "locus", route: (k) => `/locus/${encodeURIComponent(k)}`, unit: "genes", unitOne: "gene" },
  trait: { icon: Activity, label: "trait", route: (k) => `/traits?trait=${encodeURIComponent(k)}`, unit: "loci", unitOne: "locus" },
};

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const resultQ = useQuery({
    queryKey: ["explore", "search", q],
    enabled: q.length > 0,
    queryFn: () => jointSearch(q),
  });
  const hits = resultQ.data ?? null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    setParams(v ? { q: v } : {});
  };

  return (
    <div className="max-w-2xl mx-auto py-4">
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border border-primary/30 rounded-lg px-3 py-2.5 mb-6"
      >
        <Search className="size-4 text-base-content/40 shrink-0" />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Gene, locus, region (chr:pos), rsID, or trait…"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-base-content/50"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-7 h-7 rounded-full bg-primary text-primary-content hover:bg-primary/90 flex items-center justify-center shrink-0 disabled:opacity-40 cursor-pointer"
        >
          <ArrowRight size={14} />
        </button>
      </form>

      {!q && (
        <p className="text-sm text-base-content/40 text-center">
          Search for a gene, locus, region, rsID, or trait.
        </p>
      )}
      {q && resultQ.isLoading && (
        <p className="text-sm text-base-content/40">Searching…</p>
      )}
      {resultQ.isError && (
        <p className="text-sm text-error break-words">
          {resultQ.error instanceof Error
            ? resultQ.error.message
            : "Search failed."}
        </p>
      )}
      {hits && hits.length === 0 && (
        <p className="text-sm text-base-content/40">
          No matches for <span className="font-mono">{q}</span>.
        </p>
      )}

      {hits && hits.length > 0 && (
        <div className="border border-base-300 rounded-md divide-y divide-base-300">
          {hits.map((h) => {
            const m = TYPE_META[h.type];
            const Icon = m.icon;
            return (
              <Link
                key={`${h.type}:${h.key}`}
                to={m.route(h.key)}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-base-200/50"
              >
                <Icon className="size-4 text-base-content/40 shrink-0" />
                <span className="font-mono font-medium min-w-0 truncate">{h.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-base-content/40 shrink-0">
                  {m.label}
                </span>
                <span className="ml-auto text-xs text-base-content/40 tabular-nums shrink-0">
                  {h.n} {h.n === 1 ? m.unitOne : m.unit}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
