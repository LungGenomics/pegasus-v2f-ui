// Config workspace — Phase 4 state.
//
// Sources list at /config; clicking a source row opens the source
// detail editor in-place. "Add data" launches the wizard. Selection
// is held in URL state (?source=name) so refresh keeps the view.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Plus, Database, FlaskConical, Loader2, UploadCloud } from "lucide-react";
import { listSources } from "../../data/sourceOps";
import {
  getDirtyState,
  snapshotPublishState,
  type DirtyState,
} from "../../data/dirtyState";
import { loadSharedDuckDB, exportDuckDBBytes } from "../../data/select";
import {
  getSyncSession,
  signIn,
  signOut,
  publish,
} from "../../data/syncClient";
import { AddSource } from "./add-source";
import { SourceDetailEditor } from "./source-detail";
import { TraitsList } from "./traits-list";
import { TraitDetailPanel } from "./trait-detail";
import { StudiesList } from "./studies-list";

export function ConfigWorkspace() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const selectedSource = params.get("source");

  const qc = useQueryClient();
  const sourcesQ = useQuery({
    queryKey: ["config", "sources"],
    queryFn: listSources,
  });
  // Keyed under ["config"] so the existing invalidateQueries(["config"])
  // calls (source-detail refetch, prune, build, etc.) refresh it too.
  const dirtyQ = useQuery({
    queryKey: ["config", "dirty"],
    queryFn: getDirtyState,
  });
  const dirtySources = dirtyQ.data?.dirtySources ?? new Set<string>();

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
          // Refresh sources AND the dirty tracker (ingest = an edit).
          void qc.invalidateQueries({ queryKey: ["config"] });
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
      <DirtyBar
        state={dirtyQ.data}
        onDiscarded={async () => {
          await qc.invalidateQueries();
        }}
      />
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
          dirty={dirtySources}
          onAdd={() => setAdding(true)}
          onOpen={(name) => setParams({ source: name })}
        />
      )}
    </div>
  );
}

function DirtyBar({
  state,
  onDiscarded,
}: {
  state: DirtyState | undefined;
  onDiscarded: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "discard" | "publish">(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [session, setSession] = useState(getSyncSession());
  if (!state?.anyDirty) return null;

  const n = state.dirtySources.size;

  const discard = async () => {
    if (
      !window.confirm(
        "Discard all local changes and re-pull the last published " +
          "shared database? Unpublished edits will be lost.",
      )
    )
      return;
    setErr(null);
    setMsg(null);
    setBusy("discard");
    try {
      await loadSharedDuckDB();
      await onDiscarded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPublish = async () => {
    setErr(null);
    setMsg(null);
    setBusy("publish");
    try {
      const bytes = await exportDuckDBBytes();
      const res = await publish(bytes);
      await snapshotPublishState(res.current_key);
      await onDiscarded(); // invalidates queries → dirty state clears
      setMsg(`Published ${res.current_key}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      if (/sign in again/i.test(m)) setSession(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="alert alert-warning py-2 mb-4 text-sm flex-wrap">
      <span className="size-2 rounded-full bg-warning-content/70 shrink-0" />
      <span className="flex-1">
        Unsaved changes —{" "}
        {n > 0 && (
          <strong>
            {n} source{n === 1 ? "" : "s"} modified
          </strong>
        )}
        {state.hasDeletions && (n > 0 ? ", plus deletions" : <strong>deletions</strong>)}{" "}
        since the last sync. Local only — not yet published.
      </span>
      {msg && <span className="text-success">{msg}</span>}
      {err && <span className="text-error">{err}</span>}
      <button
        type="button"
        className="btn btn-xs"
        onClick={() => void discard()}
        disabled={busy !== null}
      >
        {busy === "discard" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : null}
        Discard (re-pull shared)
      </button>
      {session ? (
        <>
          <button
            type="button"
            className="btn btn-xs btn-primary gap-1"
            onClick={() => void doPublish()}
            disabled={busy !== null}
            title={`Publish to the shared DB as @${session.login}`}
          >
            {busy === "publish" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <UploadCloud className="size-3" />
            )}
            Publish
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => {
              signOut();
              setSession(null);
            }}
            title={`Signed in as @${session.login}`}
          >
            @{session.login} · sign out
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-xs btn-primary gap-1"
          onClick={() => signIn()}
        >
          <UploadCloud className="size-3" />
          Sign in to publish
        </button>
      )}
    </div>
  );
}

function SourcesTab({
  sources,
  loading,
  dirty,
  onAdd,
  onOpen,
}: {
  sources: import("../../api/types").ConfigSource[];
  loading: boolean;
  dirty: Set<string>;
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
                  <div className="font-medium text-sm truncate flex items-center gap-1.5">
                    {dirty.has(s.id) && (
                      <span
                        className="size-1.5 rounded-full bg-warning shrink-0"
                        title="Modified since last sync — not yet published"
                      />
                    )}
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
