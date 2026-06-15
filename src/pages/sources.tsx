// Sources tab (redesign) — full-width workspace. Left = source list, which
// collapses to a thin strip once a source is selected so the work-area (table
// + inspector) gets the room; click the strip to re-expand. Selection is held
// in URL state (?source=name) so refresh keeps it. Right pane: the add panel
// (adding) or the source work-area (a source is selected).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus, PanelLeftClose, PanelLeftOpen, Braces } from "lucide-react";
import { listSources } from "../data/sourceOps";
import { SourceConfigImportModal } from "../components/source-config-import";
import { useSyncSession } from "../hooks/useSyncSession";
import { AddSourcePanel } from "./sources-add";
import { SourceWorkArea } from "./source-workarea";

export function SourcesPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const qc = useQueryClient();
  const session = useSyncSession();
  const actor = session?.login ?? null;
  const selected = params.get("source");

  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });
  const sources = sourcesQ.data ?? [];

  // The list collapses to a thin strip (the collapse control is always
  // available, not only when a source is selected).
  const showStrip = collapsed && !adding;

  const selectSource = (name: string) => {
    setAdding(false);
    setParams({ source: name });
  };
  const startAdd = () => {
    setAdding(true);
    setParams({});
  };

  return (
    <div
      className={`grid gap-6 h-[calc(100vh-6.25rem)] ${
        showStrip ? "grid-cols-[3rem_1fr]" : "grid-cols-[minmax(220px,340px)_1fr]"
      }`}
    >
      {showStrip ? (
        /* Collapsed strip */
        <div className="self-start max-h-full border border-base-300 rounded-lg p-1.5 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand sources"
            className="p-1.5 rounded-md hover:bg-base-200 text-base-content/60 cursor-pointer"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <button
            type="button"
            onClick={startAdd}
            title="Add source"
            className="p-1.5 rounded-md hover:bg-base-200 text-primary cursor-pointer"
          >
            <Plus className="size-4" />
          </button>
        </div>
      ) : (
        /* Full source list */
        <div className="self-start max-h-full border border-base-300 rounded-lg p-3 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
              {sources.length} {sources.length === 1 ? "Source" : "Sources"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConfigOpen(true)}
                title="Power-user: import a source from config JSON"
                className="text-base-content/40 hover:text-base-content cursor-pointer p-0.5"
              >
                <Braces className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                title="Collapse list"
                className="text-base-content/40 hover:text-base-content cursor-pointer p-0.5"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-0">
            {sourcesQ.isLoading ? (
              <p className="text-xs text-base-content/40 px-2 py-1">Loading…</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {sources.map((s) => {
                  const isActive = !adding && s.name === selected;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectSource(s.name)}
                      className={`px-3 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-base-200 text-base-content"
                      }`}
                    >
                      <span className="text-sm truncate block">
                        {s.display_name || s.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="btn btn-primary btn-sm gap-1 w-full mt-3 shrink-0"
          >
            <Plus className="size-3.5" />
            Add source
          </button>
        </div>
      )}

      {/* Right: work area */}
      <div className="min-w-0 h-full overflow-auto">
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
          <SourceWorkArea name={selected} onDeleted={() => setParams({})} />
        ) : (
          <div className="border border-dashed border-base-300 rounded-lg p-16 text-center text-sm text-base-content/40">
            Select a source to work on it, or add a new one.
          </div>
        )}
      </div>

      {configOpen && (
        <SourceConfigImportModal
          actor={actor}
          onImported={() => {
            // Fires after the modal's post-import rebuild — refresh everything
            // (config lists + the derived explore/traits/loci views).
            void qc.invalidateQueries();
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}
