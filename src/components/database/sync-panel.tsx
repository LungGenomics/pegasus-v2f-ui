// Combined Database panel: the one place for the DB file + its sync. Local
// file controls (which DB is active · replace · export) come from
// DataSourcePicker; below them, the R2 sync: status (sign-in, dirty count,
// current published version), Publish (local → R2), Pull latest (R2 → local),
// and a published-version history list with Restore. GitHub-Desktop-ish status
// + Vercel-deployments-ish history.

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UploadCloud,
  DownloadCloud,
  RotateCcw,
  Loader2,
  Lock,
  Download,
  Upload,
  FilePlus2,
} from "lucide-react";
import {
  fetchSyncInfo,
  fetchHistory,
  fetchLockHolder,
  acquireLock,
  releaseLock,
  getLease,
  publish,
  restore,
  signIn,
} from "../../data/syncClient";
import {
  exportDuckDB,
  exportDuckDBBytes,
  loadSharedDuckDB,
  createNewDuckDB,
  attachDuckDBFile,
} from "../../data/select";
import { getDirtyState, snapshotPublishState } from "../../data/dirtyState";
import { useSyncSession } from "../../hooks/useSyncSession";

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DatabasePanel() {
  const qc = useQueryClient();
  const session = useSyncSession();
  const [busy, setBusy] = useState<"publish" | "pull" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirtyQ = useQuery({
    queryKey: ["config", "dirty-state"],
    queryFn: getDirtyState,
  });
  const infoQ = useQuery({ queryKey: ["sync-info"], queryFn: fetchSyncInfo });
  const historyQ = useQuery({ queryKey: ["sync-history"], queryFn: fetchHistory });
  const lockQ = useQuery({ queryKey: ["lock-holder"], queryFn: fetchLockHolder });

  const dirty = dirtyQ.data;
  const lockHolder = lockQ.data;
  const heldByOther =
    !!lockHolder && lockHolder.login !== session?.login;

  const refreshSync = () => {
    void qc.invalidateQueries({ queryKey: ["config", "dirty-state"] });
    void qc.invalidateQueries({ queryKey: ["sync-info"] });
    void qc.invalidateQueries({ queryKey: ["sync-history"] });
    void qc.invalidateQueries({ queryKey: ["lock-holder"] });
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPublish = () =>
    run("publish", async () => {
      if (!getLease()) await acquireLock();
      const bytes = await exportDuckDBBytes();
      const res = await publish(bytes);
      await snapshotPublishState(res.current_key);
      await releaseLock();
      refreshSync();
    });

  const doPull = () =>
    run("pull", async () => {
      if (
        !window.confirm(
          "Replace your local database with the latest published version? Unpublished changes will be lost.",
        )
      ) {
        return;
      }
      await loadSharedDuckDB();
      void qc.invalidateQueries(); // whole DB swapped
    });

  const doExport = () => run("export", async () => exportDuckDB());

  const doNew = () =>
    run("new", async () => {
      if (
        !window.confirm(
          "Start a blank database? The current one is unloaded — publish or export first to keep it.",
        )
      ) {
        return;
      }
      await createNewDuckDB();
      void qc.invalidateQueries();
    });

  const doUpload = (file: File) =>
    run("upload", async () => {
      await attachDuckDBFile(file);
      void qc.invalidateQueries();
    });

  const doRestore = (key: string) =>
    run(key, async () => {
      if (
        !window.confirm(
          "Restore this published version as the current one, then load it locally?",
        )
      ) {
        return;
      }
      if (!getLease()) await acquireLock();
      await restore(key);
      await releaseLock();
      await loadSharedDuckDB();
      void qc.invalidateQueries();
    });

  const info = infoQ.data;
  const history = historyQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-base-content/60">Database</h2>
        {session ? (
          <span className="text-xs text-base-content/50">
            signed in as <span className="font-mono">@{session.login}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => signIn()}
            className="text-xs text-primary hover:underline cursor-pointer"
          >
            Sign in to publish
          </button>
        )}
      </div>

      {/* Status line */}
      <div className="text-xs text-base-content/60 space-y-1">
        <p>
          {info?.current_key ? (
            <>
              Published version <span className="font-mono">{info.current_key.slice(0, 12)}</span>
              {info.published_by && <> by <span className="font-mono">@{info.published_by}</span></>}
              {info.published_at && <> · {relTime(info.published_at)}</>}
            </>
          ) : (
            "No version published yet."
          )}
        </p>
        <p>
          {dirty?.anyDirty ? (
            <span className="text-warning">
              {dirty.dirtySources.size} of {dirty.total} source
              {dirty.total === 1 ? "" : "s"} changed since last publish
              {dirty.hasDeletions ? " (+ deletions)" : ""}.
            </span>
          ) : (
            <span className="text-success">Up to date with the published version.</span>
          )}
        </p>
        {heldByOther && (
          <p className="text-warning inline-flex items-center gap-1">
            <Lock className="size-3" /> @{lockHolder!.login} is editing — publishing is locked.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={doPublish}
          disabled={!session || busy !== null || heldByOther || !dirty?.anyDirty}
          className="btn btn-neutral btn-sm gap-1"
          title={!session ? "Sign in to publish" : undefined}
        >
          {busy === "publish" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UploadCloud className="size-3.5" />
          )}
          Publish
        </button>
        <button
          type="button"
          onClick={doPull}
          disabled={busy !== null}
          className="btn btn-ghost btn-sm gap-1"
        >
          {busy === "pull" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <DownloadCloud className="size-3.5" />
          )}
          Pull latest
        </button>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".duckdb"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) doUpload(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm gap-1"
            title="Load a .duckdb file from disk (replaces the current one)"
          >
            {busy === "upload" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm gap-1"
            title="Download the current database file"
          >
            {busy === "export" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export
          </button>
          <button
            type="button"
            onClick={doNew}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm gap-1 text-base-content/50 hover:text-error"
            title="Unload and start a blank database"
          >
            {busy === "new" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="size-3.5" />
            )}
            New
          </button>
        </div>
      </div>

      {/* Version history */}
      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-base-content/70 mb-1.5">
            Version history
          </h3>
          <div className="border border-base-300 rounded-md divide-y divide-base-300 max-h-56 overflow-auto">
            {history
              .filter((h) => h.current_key)
              .map((h) => {
                const versionKey = h.current_key!;
                const isCurrent = versionKey === info?.current_key;
                return (
                  <div
                    key={h.key}
                    className="flex items-center gap-3 px-3 py-2 text-xs"
                  >
                    {h.published_by && (
                      <span className="font-mono text-base-content/70">
                        @{h.published_by}
                      </span>
                    )}
                    <span className="text-base-content/40">
                      {relTime(h.published_at)}
                    </span>
                    {h.restored_from && (
                      <span className="text-base-content/30 italic">restored</span>
                    )}
                    {isCurrent ? (
                      <span className="ml-auto badge badge-xs badge-success">
                        current
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => doRestore(versionKey)}
                        disabled={!session || busy !== null || heldByOther}
                        className="ml-auto inline-flex items-center gap-1 text-primary hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline"
                      >
                        {busy === versionKey ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-error break-words">{error}</p>}
    </div>
  );
}
