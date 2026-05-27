// Sources tab (redesign) — full-width two-column workspace (BEDbase-workbench
// style): left = list of sources, right = the area to work on the selected
// one. Selection is held in URL state (?source=name) so refresh keeps it.
// The right-pane authoring (raw grid → transforms → mappings) is a placeholder
// for now; the add flow reuses the existing ingest-on-add component.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus, Database } from "lucide-react";
import { listSources } from "../data/sourceOps";
import { AddSourcePanel } from "./sources-add";

export function SourcesPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const selected = params.get("source");

  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });
  const sources = sourcesQ.data ?? [];

  return (
    <div className="grid gap-6 grid-cols-[minmax(220px,340px)_1fr]">
      {/* Left: source list */}
      <div className="self-start border border-base-300 rounded-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
            {sources.length} {sources.length === 1 ? "Source" : "Sources"}
          </span>
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setParams({});
            }}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
          >
            <Plus className="size-3.5" />
            Add
          </button>
        </div>

        {sourcesQ.isLoading ? (
          <p className="text-xs text-base-content/40 px-2 py-1">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="text-xs text-base-content/40 px-2 py-1">No sources yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sources.map((s) => {
              const isActive = !adding && s.name === selected;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setParams({ source: s.name });
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-base-200 text-base-content"
                  }`}
                >
                  <Database
                    className={`size-3.5 shrink-0 ${isActive ? "text-primary" : "text-base-content/40"}`}
                  />
                  <span className="text-sm truncate flex-1">
                    {s.display_name || s.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: work area */}
      <div className="min-w-0">
        {adding ? (
          <AddSourcePanel
            onCancel={() => setAdding(false)}
            onDone={(name) => {
              setAdding(false);
              void qc.invalidateQueries({ queryKey: ["config"] });
              setParams({ source: name });
            }}
          />
        ) : selected ? (
          <SourceWorkArea name={selected} />
        ) : (
          <div className="border border-dashed border-base-300 rounded-lg p-16 text-center text-sm text-base-content/40">
            Select a source to work on it, or add a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function SourceWorkArea({ name }: { name: string }) {
  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">{name}</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Clean the raw data with transforms, then map it into evidence or loci.
      </p>
      <div className="border border-dashed border-base-300 rounded-lg p-12 text-center text-sm text-base-content/40">
        Placeholder — raw grid → transforms → mappings go here.
      </div>
    </div>
  );
}
