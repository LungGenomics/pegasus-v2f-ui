import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  attachDuckDBFile,
  detachDuckDB,
  exportDuckDB,
  getDataSourceState,
  subscribeDataSource,
} from "../data/select";
import { getMeta, type DuckDBOpfsMeta } from "../data/opfs";

export function DataSourcePicker() {
  const [state, setState] = useState(getDataSourceState());
  const [meta, setMeta] = useState<DuckDBOpfsMeta | null>(getMeta());
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribeDataSource(() => {
      setState(getDataSourceState());
      setMeta(getMeta());
    });
  }, []);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await attachDuckDBFile(file);
      await queryClient.invalidateQueries();
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const onForget = async () => {
    setBusy(true);
    try {
      await detachDuckDB();
      await queryClient.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setBusy(true);
    try {
      await exportDuckDB();
    } finally {
      setBusy(false);
    }
  };

  if (state === "duckdb-wasm") {
    return (
      <div className="flex items-center gap-2">
        <span
          className="text-xs text-primary truncate max-w-[200px]"
          title={meta?.name ?? "DuckDB"}
        >
          DuckDB · {meta?.name ?? "(in-memory)"}
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="text-xs text-base-content/60 hover:text-base-content"
          title="Replace with a different .duckdb file"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="text-xs text-base-content/60 hover:text-base-content"
          title="Download the current DuckDB to disk"
        >
          Export
        </button>
        <button
          type="button"
          onClick={onForget}
          disabled={busy}
          className="text-xs text-base-content/60 hover:text-base-content"
          title="Forget the saved DuckDB"
        >
          Forget
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".duckdb"
          className="hidden"
          onChange={onPickFile}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".duckdb"
        className="hidden"
        onChange={onPickFile}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className={`text-xs px-2 py-1 rounded border border-base-300 text-base-content/60 hover:text-base-content ${
          busy ? "opacity-50 cursor-wait" : ""
        }`}
        title="Open a .duckdb file (persisted in browser storage)"
      >
        {busy ? "Loading…" : "Open .duckdb"}
      </button>
    </div>
  );
}
