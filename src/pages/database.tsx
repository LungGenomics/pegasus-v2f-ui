// Database tab (redesign). The "this is one DuckDB file" surface: DB
// load/export controls + the derived-layer controls (gene reference URL +
// rebuild of evidence/loci/locus_evidence). Table browser / SQL console /
// publish history are still placeholders.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { DataSourcePicker } from "../components/data-source-picker";
import {
  getPegasusSettings,
  updatePegasusSettings,
} from "../data/settingsOps";
import { rebuildDerived, type RebuildDerivedResult } from "../data/pipeline/derived";

export function DatabasePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold mb-1">Database</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Browse tables, run ad-hoc SQL, and manage version history.
      </p>

      <section className="border border-base-300 rounded-lg bg-base-100 p-4 mb-6">
        <h2 className="text-sm font-medium text-base-content/60 mb-3">
          Database file
        </h2>
        <DataSourcePicker />
      </section>

      <DerivedDataSection />

      <div className="border border-dashed border-base-300 rounded-lg p-10 text-center text-sm text-base-content/40">
        Placeholder — table browser, SQL console, and publish/history go here.
      </div>
    </div>
  );
}

// Derived layer: evidence (view) + loci (table) + locus_evidence (view).
// Reads from sources/mappings; needs the gene-reference parquet for candidate
// genes. Rebuild is manual here (no Build tab) — the views are cheap, loci is
// the one real computation.
function DerivedDataSection() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ["pegasus-settings"],
    queryFn: getPegasusSettings,
  });

  const [url, setUrl] = useState<string | null>(null);
  const [biotypes, setBiotypes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RebuildDerivedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = settingsQ.data;
  // Controlled values fall back to the persisted setting until edited.
  const urlVal = url ?? settings?.gene_reference_url ?? "";
  const biotypesVal = biotypes ?? settings?.candidate_gene_biotypes ?? "";

  const saveSettings = async () => {
    await updatePegasusSettings({
      gene_reference_url: urlVal || null,
      candidate_gene_biotypes: biotypesVal || null,
    });
    void qc.invalidateQueries({ queryKey: ["pegasus-settings"] });
    void qc.invalidateQueries({ queryKey: ["config"] });
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Persist any edited settings first so the rebuild reads them.
      await saveSettings();
      const r = await rebuildDerived();
      setResult(r);
      // Derived relations changed — Explore reads these.
      void qc.invalidateQueries({ queryKey: ["explore"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalLoci = result?.loci.reduce((n, l) => n + l.loci, 0) ?? 0;

  return (
    <section className="border border-base-300 rounded-lg bg-base-100 p-4 mb-6 space-y-3">
      <h2 className="text-sm font-medium text-base-content/60">Derived data</h2>
      <p className="text-xs text-base-content/50">
        Rebuilds <span className="font-mono">evidence</span>,{" "}
        <span className="font-mono">loci</span>, and{" "}
        <span className="font-mono">locus_evidence</span> from your sources and
        mappings. Candidate genes need the gene-reference parquet below.
      </p>

      <label className="block">
        <span className="block text-xs text-base-content/50 mb-1">
          Gene reference URL (hg38 parquet)
        </span>
        <input
          value={urlVal}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void saveSettings()}
          placeholder="https://…/reference/gencode_genes_hg38.parquet"
          className="input input-bordered input-sm w-full font-mono text-xs"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-base-content/50 mb-1">
          Candidate gene biotypes{" "}
          <span className="text-base-content/40">(comma list; blank = all)</span>
        </span>
        <input
          value={biotypesVal}
          onChange={(e) => setBiotypes(e.target.value)}
          onBlur={() => void saveSettings()}
          placeholder="protein_coding,lncRNA"
          className="input input-bordered input-sm w-full font-mono text-xs"
        />
      </label>

      <button
        type="button"
        onClick={() => void rebuild()}
        disabled={busy}
        className="btn btn-neutral btn-sm gap-1"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Rebuild derived data
      </button>

      {result && (
        <div className="text-xs text-success space-y-0.5">
          <p>
            Built {result.loci.length} loci source(s), {totalLoci} loci total.
          </p>
          {result.geneReferenceRows != null && (
            <p>Gene reference: {result.geneReferenceRows.toLocaleString()} genes.</p>
          )}
          {result.skipped && (
            <p className="text-warning">{result.skipped}</p>
          )}
        </div>
      )}
      {error && <p className="text-xs text-error break-words">{error}</p>}
    </section>
  );
}
