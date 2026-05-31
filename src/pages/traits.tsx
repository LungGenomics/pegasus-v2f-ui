// Traits — the track-centric trait browser. Left: traits ordered by most
// evidence (n_loci) with a filter box; collapses to a strip once a trait is
// selected (like Sources). Right: that trait's detail (genome track + loci +
// heatmap + sources). Selection in ?trait= so it's linkable.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { listTraits } from "../data/queries/explore";
import { TraitDetail } from "./explore/trait-detail";

export function TraitsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("trait");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const traitsQ = useQuery({ queryKey: ["explore", "traits"], queryFn: listTraits });
  const traits = traitsQ.data ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q ? traits.filter((t) => t.label.toLowerCase().includes(q)) : traits;

  const select = (id: string) => setParams({ trait: id });
  const showStrip = collapsed;

  return (
    <div
      className={`grid gap-6 items-start ${
        showStrip ? "grid-cols-[3rem_1fr]" : "grid-cols-[minmax(220px,300px)_1fr]"
      }`}
    >
      {showStrip ? (
        <div className="self-start max-h-[calc(100vh-6.25rem)] border border-base-300 rounded-lg p-1.5 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand traits"
            className="p-1.5 rounded-md hover:bg-base-200 text-base-content/60 cursor-pointer"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      ) : (
        <div className="self-start max-h-[calc(100vh-6.25rem)] border border-base-300 rounded-lg p-3 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
              {traits.length} {traits.length === 1 ? "Trait" : "Traits"}
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Collapse list"
              className="text-base-content/40 hover:text-base-content cursor-pointer"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>

          <div className="relative mb-2 shrink-0">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40 z-10" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter traits…"
              className="input input-bordered input-sm h-7 min-h-7 w-full pl-8 text-xs"
            />
          </div>

          <div className="flex-1 overflow-auto min-h-0">
            {traitsQ.isLoading ? (
              <p className="text-xs text-base-content/40 px-2 py-1">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-xs text-base-content/40 px-2 py-1">No traits.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {shown.map((t) => (
                  <button
                    key={t.trait_id}
                    type="button"
                    onClick={() => select(t.trait_id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                      selected === t.trait_id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-base-200 text-base-content"
                    }`}
                  >
                    <span className="text-sm truncate flex-1 min-w-0">{t.label}</span>
                    <span className="text-xs text-base-content/40 tabular-nums shrink-0">
                      {t.n_loci}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected trait — flows in the page scroll (not its own scroller). */}
      <div className="min-w-0">
        {selected ? (
          <TraitDetail key={selected} traitId={selected} />
        ) : (
          <div className="border border-dashed border-base-300 rounded-lg p-16 text-center text-sm text-base-content/40">
            Select a trait to explore its loci and evidence.
          </div>
        )}
      </div>
    </div>
  );
}
