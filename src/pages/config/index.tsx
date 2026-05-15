// Config workspace — Phase 4 state.
//
// Sources list at /config; clicking a source row opens the source
// detail editor in-place. "Add data" launches the wizard. Selection
// is held in URL state (?source=name) so refresh keeps the view.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus, Database, FlaskConical, ArrowLeft } from "lucide-react";
import { listSources } from "../../data/sourceOps";
import { AddDataWizard } from "./add-data-wizard";
import { SourceDetailEditor } from "./source-detail";

export function ConfigWorkspace() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const selectedSource = params.get("source");

  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });

  if (selectedSource) {
    return (
      <SourceDetailEditor
        sourceName={selectedSource}
        onBack={() => setParams({})}
      />
    );
  }

  if (adding) {
    return (
      <div>
        <button
          onClick={() => setAdding(false)}
          className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content mb-4"
        >
          <ArrowLeft className="size-3.5" />
          Sources
        </button>
        <AddDataWizard
          onCancel={() => setAdding(false)}
          onDone={(name) => {
            setAdding(false);
            void sourcesQ.refetch();
            // Jump into the new source's detail page so the user can
            // add more derivations or rebuild without hunting for it.
            setParams({ source: name });
          }}
        />
      </div>
    );
  }

  const sources = sourcesQ.data ?? [];

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-semibold">Sources</h1>
        <span className="text-sm text-base-content/40">
          {sources.length} source{sources.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-sm btn-primary gap-1"
        >
          <Plus className="size-3.5" />
          Add data
        </button>
      </div>

      {sourcesQ.isLoading ? (
        <div className="text-base-content/40 text-sm">Loading…</div>
      ) : sources.length === 0 ? (
        <div className="border border-dashed border-base-300 rounded-lg p-8 text-center">
          <Database className="size-8 mx-auto text-base-content/20 mb-2" />
          <p className="text-sm text-base-content/60">
            No sources configured yet. Click <strong>Add data</strong> to
            ingest your first one.
          </p>
        </div>
      ) : (
        <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
          {sources.map((s, i) => {
            const isStudy = Boolean(s.citation?.gwas_source);
            return (
              <button
                key={s.id}
                type="button"
                className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-base-200/40 transition-colors ${
                  i > 0 ? "border-t border-base-300" : ""
                }`}
                onClick={() => setParams({ source: s.name })}
              >
                {isStudy ? (
                  <FlaskConical className="size-4 text-base-content/40" />
                ) : (
                  <Database className="size-4 text-base-content/40" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {s.display_name ?? s.name}
                  </div>
                  <div className="text-xs text-base-content/50 flex gap-2 items-center">
                    <code className="font-mono">{s.name}</code>
                    <span>·</span>
                    <span>{s.source_type}</span>
                    {s.citation?.gwas_source && (
                      <>
                        <span>·</span>
                        <span>{s.citation.gwas_source}</span>
                      </>
                    )}
                    {s.trait_ids && s.trait_ids.length > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {s.trait_ids.length} declared trait
                          {s.trait_ids.length === 1 ? "" : "s"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
