// Database tab (redesign). The "this is one DuckDB file" surface: DB
// load/export controls + the derived-layer controls (candidate-gene biotype
// filter + rebuild of evidence/loci/locus_evidence). Table browser / SQL
// console / publish history are still placeholders.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { DataSourcePicker } from "../components/data-source-picker";
import {
  getPegasusSettings,
  updatePegasusSettings,
} from "../data/settingsOps";
import { listGeneBiotypes } from "../data/pipeline/geneReference";
import {
  rebuildDerived,
  refreshLociEvidenceForBiotypes,
  type RebuildDerivedResult,
} from "../data/pipeline/derived";

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
// The gene reference is built-in (no URL to configure). The one meaningful
// knob is which gene biotypes count as a locus's candidate genes — and
// changing that only rebuilds the locus_evidence view (the full parquet stays
// cached; no refetch).
function DerivedDataSection() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ["pegasus-settings"],
    queryFn: getPegasusSettings,
  });
  const biotypesQ = useQuery({
    queryKey: ["gene-biotypes"],
    queryFn: listGeneBiotypes,
  });

  const [busy, setBusy] = useState<"rebuild" | "biotypes" | null>(null);
  const [result, setResult] = useState<RebuildDerivedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Selection state. Empty `candidate_gene_biotypes` setting = all biotypes.
  const persisted = (settingsQ.data?.candidate_gene_biotypes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // null = use persisted; otherwise a local edit (Set of selected biotypes,
  // empty Set = "all").
  const [edited, setEdited] = useState<Set<string> | null>(null);
  const allMode = edited ? edited.size === 0 : persisted.length === 0;
  const isSelected = (bt: string) =>
    allMode ? true : (edited ?? new Set(persisted)).has(bt);

  const biotypes = biotypesQ.data ?? [];
  const dirty = edited !== null;

  const toggle = (bt: string) => {
    const base = edited ?? new Set(allMode ? [] : persisted);
    const next = new Set(base);
    // Leaving "all" mode: start from everything checked, then toggle off.
    if (allMode) biotypes.forEach((b) => next.add(b.gene_type));
    if (next.has(bt)) next.delete(bt);
    else next.add(bt);
    // If everything is selected, collapse back to "all" (empty = no filter).
    if (next.size === biotypes.length) next.clear();
    setEdited(next);
  };

  const setAll = () => setEdited(new Set());

  const saveBiotypes = async () => {
    const sel = edited ?? new Set(persisted);
    // Empty selection = all biotypes = no filter (empty string).
    const value = sel.size === 0 ? "" : Array.from(sel).join(",");
    await updatePegasusSettings({ candidate_gene_biotypes: value });
    void qc.invalidateQueries({ queryKey: ["pegasus-settings"] });
    void qc.invalidateQueries({ queryKey: ["config"] });
  };

  const applyBiotypes = async () => {
    setBusy("biotypes");
    setError(null);
    try {
      await saveBiotypes();
      await refreshLociEvidenceForBiotypes();
      setEdited(null);
      void qc.invalidateQueries({ queryKey: ["explore"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy("rebuild");
    setError(null);
    setResult(null);
    try {
      if (dirty) await saveBiotypes();
      const r = await rebuildDerived();
      setResult(r);
      setEdited(null);
      void qc.invalidateQueries({ queryKey: ["gene-biotypes"] });
      void qc.invalidateQueries({ queryKey: ["explore"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loaded = biotypes.length > 0;

  return (
    <section className="border border-base-300 rounded-lg bg-base-100 p-4 mb-6 space-y-3">
      <h2 className="text-sm font-medium text-base-content/60">Derived data</h2>
      <p className="text-xs text-base-content/50">
        Rebuilds <span className="font-mono">evidence</span>,{" "}
        <span className="font-mono">loci</span>, and{" "}
        <span className="font-mono">locus_evidence</span> from your sources and
        mappings.
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-base-content/70">
            Candidate gene biotypes
          </span>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={allMode}
              onChange={setAll}
            />
            All biotypes
          </label>
        </div>
        {loaded ? (
          <div className="max-h-44 overflow-auto border border-base-300 rounded-md p-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {biotypes.map((b) => (
              <label
                key={b.gene_type}
                className="flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={isSelected(b.gene_type)}
                  onChange={() => toggle(b.gene_type)}
                />
                <span className="font-mono truncate">{b.gene_type}</span>
                <span className="text-base-content/40 ml-auto shrink-0">
                  {b.n.toLocaleString()}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-base-content/40">
            Rebuild once to load the gene reference, then pick biotypes here.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void rebuild()}
          disabled={busy !== null}
          className="btn btn-neutral btn-sm gap-1"
        >
          {busy === "rebuild" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Rebuild derived data
        </button>
        {dirty && loaded && (
          <button
            type="button"
            onClick={() => void applyBiotypes()}
            disabled={busy !== null}
            className="btn btn-ghost btn-sm"
          >
            {busy === "biotypes" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Apply biotypes
          </button>
        )}
      </div>

      {result && (
        <div className="text-xs space-y-0.5">
          <p className="text-success">
            evidence: {result.evidenceRows.toLocaleString()} rows · loci:{" "}
            {result.totalLoci.toLocaleString()} ({result.loci.length} source
            {result.loci.length === 1 ? "" : "s"}) · locus_evidence:{" "}
            {result.locusEvidenceRows.toLocaleString()} rows
          </p>
          <p className="text-success">
            Gene reference: {result.geneReferenceRows.toLocaleString()} genes ·
            loci with candidate genes: {result.lociWithCandidates.toLocaleString()}/
            {result.totalLoci.toLocaleString()}
          </p>
          {result.totalLoci > 0 && result.lociWithCandidates === 0 && (
            <p className="text-warning">
              No loci matched any candidate genes — likely a chromosome-format
              mismatch (loci use a different style than the gene reference’s
              “chr1”). Add an <span className="font-mono">add_prefix</span>{" "}
              (chr) transform to the loci source, or check the chromosome
              column.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-xs text-error break-words">{error}</p>}
    </section>
  );
}
