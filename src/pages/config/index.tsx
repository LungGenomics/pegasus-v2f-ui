// Config workspace — Phase 4 state.
//
// Sources list at /config; clicking a source row opens the source
// detail editor in-place. "Add data" launches the wizard. Selection
// is held in URL state (?source=name) so refresh keeps the view.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus, Database, FlaskConical } from "lucide-react";
import { listSources } from "../../data/sourceOps";
import { AddSource } from "./add-source";
import { SourceDetailEditor } from "./source-detail";
import { TraitsList } from "./traits-list";
import { TraitDetailPanel } from "./trait-detail";
import { StudiesList } from "./studies-list";

export function ConfigWorkspace() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const selectedSource = params.get("source");

  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });

  const selectedTrait = params.get("trait");

  if (selectedSource) {
    return (
      <SourceDetailEditor
        sourceName={selectedSource}
        onBack={() => setParams({})}
        onRename={(n) => setParams({ source: n })}
      />
    );
  }

  if (selectedTrait) {
    return (
      <TraitDetailPanel
        traitId={selectedTrait}
        onBack={() => setParams({ view: "traits" })}
      />
    );
  }

  if (adding) {
    return (
      <AddSource
        onCancel={() => setAdding(false)}
        onDone={(name) => {
          setAdding(false);
          void sourcesQ.refetch();
          // Jump into the new source's detail view so the user can add
          // derivations / build against the just-ingested raw table.
          setParams({ source: name });
        }}
      />
    );
  }

  const sources = sourcesQ.data ?? [];
  const viewParam = params.get("view");
  const view =
    viewParam === "traits"
      ? "traits"
      : viewParam === "studies"
        ? "studies"
        : "sources";
  const setView = (v: "sources" | "traits" | "studies") =>
    setParams(v === "sources" ? {} : { view: v });

  return (
    <div>
      {/* Tab header — list views only; source detail and the wizard
          are drill-ins handled by the early returns. */}
      <div className="flex items-center gap-1 mb-4 border-b border-base-300">
        {(["sources", "traits", "studies"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`px-3 py-2 text-sm capitalize border-b-2 -mb-px ${
              view === v
                ? "border-primary text-base-content font-medium"
                : "border-transparent text-base-content/50 hover:text-base-content"
            }`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "traits" ? (
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <h1 className="text-lg font-semibold">Traits</h1>
          </div>
          <TraitsList
            onSelect={(traitId) => setParams({ view: "traits", trait: traitId })}
          />
        </div>
      ) : view === "studies" ? (
        <StudiesList onOpen={(name) => setParams({ source: name })} />
      ) : (
        <SourcesTab
          sources={sources}
          loading={sourcesQ.isLoading}
          onAdd={() => setAdding(true)}
          onOpen={(name) => setParams({ source: name })}
        />
      )}
    </div>
  );
}

function SourcesTab({
  sources,
  loading,
  onAdd,
  onOpen,
}: {
  sources: import("../../api/types").ConfigSource[];
  loading: boolean;
  onAdd: () => void;
  onOpen: (name: string) => void;
}) {
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
          onClick={onAdd}
          className="btn btn-sm btn-primary gap-1"
        >
          <Plus className="size-3.5" />
          Add data
        </button>
      </div>

      {loading ? (
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
                onClick={() => onOpen(s.name)}
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
