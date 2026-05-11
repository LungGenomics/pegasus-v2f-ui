// Config workspace — interim Phase 3a state.
//
// Until Phase 4 brings back the source detail editor, the workspace
// is a sources list (from config.sources) + an "Add data" wizard that
// drives the new build pipeline end-to-end. Clicking a source row is
// a no-op for now; per-source edit lands in Phase 4.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Database, FlaskConical, ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { listSources } from "../../data/sourceOps";
import { AddDataWizard } from "./add-data-wizard";

export function ConfigWorkspace() {
  const [adding, setAdding] = useState(false);

  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });

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
          onDone={() => {
            setAdding(false);
            void sourcesQ.refetch();
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
              <div
                key={s.id}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i > 0 ? "border-t border-base-300" : ""
                }`}
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
                <Link
                  to={`/sources?source=${encodeURIComponent(s.name)}`}
                  className="btn btn-ghost btn-xs"
                  title="View built rows"
                >
                  view
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-base-content/40 mt-6">
        Per-source editing (transforms, derivations, evidence preview)
        lands in Phase 4 of the redesign. The Add Data wizard creates
        one source + one derivation; multi-derivation editing is the
        same Phase 4 work.
      </p>
    </div>
  );
}
