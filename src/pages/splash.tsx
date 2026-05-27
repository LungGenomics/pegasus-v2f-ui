import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Database, HardDrive, Zap, Plus, Cloud } from "lucide-react";
import {
  attachDuckDBFile,
  createNewDuckDB,
  loadSharedDuckDB,
} from "../data/select";

export function SplashPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const attach = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      await attachDuckDBFile(file);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach file");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void attach(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.name.endsWith(".duckdb") || f.type === "",
    );
    if (file) void attach(file);
    else setError("Please drop a .duckdb file.");
  };

  const onCreateNew = async () => {
    setError(null);
    setBusy(true);
    try {
      await createNewDuckDB();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create new database",
      );
    } finally {
      setBusy(false);
    }
  };

  const onLoadShared = async () => {
    setError(null);
    setBusy(true);
    try {
      await loadSharedDuckDB();
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load the shared database",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-6xl font-thin tracking-wide mb-6">
            <span className="text-primary font-[250]">pegasus</span>
            <span className="text-base-content/30">.</span>
            <span className="text-base-content/50 font-thin">v2f</span>
          </h1>
          <p className="text-base font-normal text-base-content/50 max-w-2xl mx-auto">
            A workspace for building, exploring, and sharing variant-to-function evidence.
          </p>
        </div>

        <div
          onClick={() => !busy && fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`
            relative cursor-pointer rounded-lg border-2 border-dashed transition-colors
            ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-base-300 hover:border-primary/50"
            }
            ${busy ? "opacity-60 cursor-wait" : ""}
            px-8 py-14 text-center
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".duckdb"
            className="hidden"
            onChange={onPickFile}
          />
          <UploadCloud className="size-10 mx-auto mb-4 text-base-content/30" />
          <div className="text-lg font-medium mb-1">
            {busy ? "Loading…" : "Drop a .duckdb file here"}
          </div>
          <div className="text-sm text-base-content/60">
            {busy ? "Attaching to browser storage" : "or click to browse"}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 text-sm text-base-content/60">
          <span>or</span>
          <button
            type="button"
            onClick={onLoadShared}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 disabled:opacity-50"
          >
            <Cloud className="size-3.5" />
            Load shared database
          </button>
          <span className="text-base-content/30">·</span>
          <button
            type="button"
            onClick={onCreateNew}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 disabled:opacity-50"
          >
            <Plus className="size-3.5" />
            Create new database
          </button>
        </div>

        {error && (
          <div role="alert" className="alert alert-error mt-4 text-sm">
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8">
          <Feature
            icon={<HardDrive className="size-4" />}
            title="No server"
            body="Runs in your browser. The file never leaves your machine."
          />
          <Feature
            icon={<Database className="size-4" />}
            title="Persistent"
            body="Stored in browser storage (OPFS). Survives reloads."
          />
          <Feature
            icon={<Zap className="size-4" />}
            title="Read & write"
            body="Edit metadata, delete sources, manage config — all local."
          />
        </div>

      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-base-100 border border-base-300 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1.5 text-base-content/70">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {title}
        </span>
      </div>
      <p className="text-xs text-base-content/60 leading-relaxed">{body}</p>
    </div>
  );
}
