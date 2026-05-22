// Config workspace — Phase 4 state.
//
// Sources list at /config; clicking a source row opens the source
// detail editor in-place. "Add data" launches the wizard. Selection
// is held in URL state (?source=name) so refresh keeps the view.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  Plus,
  Database,
  FlaskConical,
  Loader2,
  UploadCloud,
  History,
} from "lucide-react";
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
  acquireLock,
  releaseLock,
  fetchLockHolder,
  getLease,
  heartbeatLock,
  fetchHistory,
  restore,
  type HistoryEntry,
} from "../../data/syncClient";
import { AddSource } from "./add-source";
import { SourceDetailEditor } from "./source-detail";
import { TraitsList } from "./traits-list";
import { TraitDetailPanel } from "./trait-detail";
import { StudiesList } from "./studies-list";

export function ConfigWorkspace() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
        onRename={(n) => {
          // Rename skips the in-editor refetch (it would 404 on the
          // old name). Invalidate ["config"] at the top so the
          // Sources list + dirty tracker refresh, then re-point the
          // route — the new SourceDetailEditor render fetches fresh
          // under the new key.
          void qc.invalidateQueries({ queryKey: ["config"] });
          setParams({ source: n });
        }}
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
          onShowHistory={() => setHistoryOpen(true)}
        />
      )}
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onAfterChange={async () => {
          await qc.invalidateQueries();
        }}
      />
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
  const [busy, setBusy] = useState<
    null | "discard" | "publish" | "lock" | "unlock"
  >(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [session, setSession] = useState(getSyncSession());
  const [lease, setLease] = useState(() => getLease());
  const qc = useQueryClient();
  const lockQ = useQuery({
    queryKey: ["sync", "lock"],
    queryFn: fetchLockHolder,
    enabled: !!session,
    refetchInterval: session ? 30_000 : false,
  });
  // Heartbeat: while we hold a lease, ping /db/lock/heartbeat at ~40%
  // of the server-side TTL (300s) so a long editing session doesn't
  // get evicted mid-edit. On any heartbeat failure (423 etc.) we
  // clear the local lease so the UI flips back to acquire.
  useEffect(() => {
    if (!session || !lease) return;
    const tick = async () => {
      try {
        setLease(await heartbeatLock());
      } catch {
        setLease(null);
        void qc.invalidateQueries({ queryKey: ["sync", "lock"] });
      }
    };
    const id = window.setInterval(() => void tick(), 120_000);
    return () => window.clearInterval(id);
  }, [session?.token, lease?.lease_token, qc]);
  if (!state?.anyDirty) return null;

  const n = state.dirtySources.size;
  const holder = lockQ.data ?? null;
  const someoneElseHolds =
    holder && session && holder.login !== session.login;
  const iHoldLock =
    holder && session && holder.login === session.login && !!lease;

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
      // Worker released the lock server-side on commit; reflect that.
      setLease(null);
      await qc.invalidateQueries({ queryKey: ["sync", "lock"] });
      await onDiscarded(); // invalidates queries → dirty state clears
      setMsg(`Published ${res.current_key}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      if (/sign in again/i.test(m)) setSession(null);
      if (/lock lost|re-acquire/i.test(m)) {
        setLease(null);
        await qc.invalidateQueries({ queryKey: ["sync", "lock"] });
      }
    } finally {
      setBusy(null);
    }
  };

  const doAcquire = async () => {
    setErr(null);
    setMsg(null);
    setBusy("lock");
    try {
      const l = await acquireLock();
      setLease(l);
      await qc.invalidateQueries({ queryKey: ["sync", "lock"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doRelease = async () => {
    setErr(null);
    setMsg(null);
    setBusy("unlock");
    try {
      await releaseLock();
      setLease(null);
      await qc.invalidateQueries({ queryKey: ["sync", "lock"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
      {!session ? (
        <button
          type="button"
          className="btn btn-xs btn-primary gap-1"
          onClick={() => signIn()}
        >
          <UploadCloud className="size-3" />
          Sign in to publish
        </button>
      ) : someoneElseHolds && holder ? (
        <>
          <span className="text-xs">
            🔒 Locked by <strong>@{holder.login}</strong> · until{" "}
            {new Date(holder.expires_at).toLocaleTimeString()}
          </span>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => {
              signOut();
              setSession(null);
              setLease(null);
            }}
          >
            @{session.login} · sign out
          </button>
        </>
      ) : iHoldLock && lease ? (
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
            Publish (lock until{" "}
            {new Date(lease.expires_at).toLocaleTimeString()})
          </button>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => void doRelease()}
            disabled={busy !== null}
          >
            {busy === "unlock" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            Release lock
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={async () => {
              await releaseLock();
              signOut();
              setSession(null);
              setLease(null);
            }}
          >
            @{session.login} · sign out
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-xs btn-primary gap-1"
            onClick={() => void doAcquire()}
            disabled={busy !== null}
            title="Take the editing lock — required to publish"
          >
            {busy === "lock" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            Acquire edit lock
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onClick={() => {
              signOut();
              setSession(null);
            }}
          >
            @{session.login} · sign out
          </button>
        </>
      )}
    </div>
  );
}

function HistoryPanel({
  open,
  onClose,
  onAfterChange,
}: {
  open: boolean;
  onClose: () => void;
  onAfterChange: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sync", "history"],
    queryFn: fetchHistory,
    enabled: open,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const doRestore = async (entry: HistoryEntry) => {
    const key = entry.current_key;
    if (!key) return;
    if (
      !window.confirm(
        `Restore ${key}?\n\nThis will advance the shared pointer to that version and re-pull it locally — your current working copy will be replaced.`,
      )
    )
      return;
    setErr(null);
    setBusy(key);
    try {
      // Take the lock if we don't already hold it.
      if (!getLease()) await acquireLock();
      await restore(key);
      // Re-pull the now-restored shared DB so local matches; this
      // also re-baselines the dirty tracker for free.
      await loadSharedDuckDB();
      await qc.invalidateQueries();
      await onAfterChange();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="modal modal-open"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="modal-box max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold mb-3">Publish history</h3>
        {q.isLoading && (
          <div className="text-sm text-base-content/40">Loading…</div>
        )}
        {q.error && (
          <div className="alert alert-error text-sm">
            {(q.error as Error).message}
          </div>
        )}
        {err && <div className="alert alert-error text-sm">{err}</div>}
        {q.data && q.data.length === 0 && (
          <div className="text-sm text-base-content/50">
            No published versions yet.
          </div>
        )}
        <ul className="divide-y divide-base-200 text-sm max-h-[60vh] overflow-auto">
          {(q.data ?? []).map((entry) => {
            const ts = entry.published_at
              ? new Date(entry.published_at).toLocaleString()
              : entry.key;
            const restoreKey = entry.current_key;
            return (
              <li
                key={entry.key}
                className="py-2 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {ts}
                    {entry.restored_from && (
                      <span className="badge badge-xs badge-info">restore</span>
                    )}
                  </div>
                  <div className="text-xs text-base-content/50 truncate">
                    by <code className="font-mono">@{entry.published_by ?? "?"}</code>
                    {restoreKey && <> · <code className="font-mono">{restoreKey}</code></>}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => void doRestore(entry)}
                  disabled={busy !== null || !restoreKey}
                  title={
                    !restoreKey
                      ? "this entry has no version key"
                      : "Restore this version"
                  }
                >
                  {busy === restoreKey && (
                    <Loader2 className="size-3 animate-spin" />
                  )}
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
        <div className="modal-action">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={busy !== null}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SourcesTab({
  sources,
  loading,
  dirty,
  onAdd,
  onOpen,
  onShowHistory,
}: {
  sources: import("../../api/types").ConfigSource[];
  loading: boolean;
  dirty: Set<string>;
  onAdd: () => void;
  onOpen: (name: string) => void;
  onShowHistory: () => void;
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
          onClick={onShowHistory}
          className="btn btn-sm btn-ghost gap-1"
          title="Past published versions of the shared database"
        >
          <History className="size-3.5" />
          History
        </button>
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
