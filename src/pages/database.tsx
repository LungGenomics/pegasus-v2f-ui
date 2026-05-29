// Database tab (redesign) — settings-style master/detail. Left: a list of
// database sections (Sync · Gene reference · Tables · SQL · Activity ·
// Settings). Right: the selected section's content. Mirrors the Sources page
// sidebar shell.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Loader2,
  Cloud,
  Dna,
  Table,
  Terminal,
  History,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { DatabasePanel } from "../components/database/sync-panel";
import { AuditPanel } from "../components/database/audit-panel";
import { TableBrowser } from "../components/database/table-browser";
import { SqlConsole } from "../components/database/sql-console";
import { SettingsPanel } from "../components/database/settings-panel";
import { useSyncSession } from "../hooks/useSyncSession";
import { getDirtyState } from "../data/dirtyState";
import {
  getPegasusSettings,
  updatePegasusSettings,
} from "../data/settingsOps";
import { listGeneBiotypes } from "../data/pipeline/geneReference";
import {
  rebuildDerived,
  type RebuildDerivedResult,
} from "../data/pipeline/derived";

const BIOTYPE_PRESETS: { label: string; codes: string[] }[] = [
  { label: "All", codes: [] },
  { label: "Protein-coding", codes: ["protein_coding"] },
  { label: "PC + lncRNA", codes: ["protein_coding", "lncRNA"] },
];

type Section = "sync" | "gene" | "tables" | "sql" | "activity" | "settings";
const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "sync", label: "Sync", icon: Cloud },
  { id: "gene", label: "Gene reference", icon: Dna },
  { id: "tables", label: "Tables", icon: Table },
  { id: "sql", label: "SQL", icon: Terminal },
  { id: "activity", label: "Activity", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

export function DatabasePage() {
  const [section, setSection] = useState<Section>("sync");
  const dirtyQ = useQuery({
    queryKey: ["config", "dirty-state"],
    queryFn: getDirtyState,
  });
  const dirty = dirtyQ.data?.anyDirty ?? false;

  // Tables/SQL fill the pane (internal scroll); the rest scroll as cards.
  const fill = section === "tables" || section === "sql";

  return (
    <div className="grid gap-6 h-[calc(100vh-6.25rem)] grid-cols-[minmax(180px,220px)_1fr]">
      <nav className="self-start max-h-full border border-base-300 rounded-lg p-1.5 flex flex-col gap-0.5 overflow-auto">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left cursor-pointer ${
                section === s.id
                  ? "bg-base-200 text-base-content font-medium"
                  : "text-base-content/60 hover:bg-base-200/50 hover:text-base-content"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 min-w-0 truncate">{s.label}</span>
              {s.id === "sync" && dirty && (
                <span
                  title="Unpublished changes"
                  className="size-1.5 rounded-full bg-warning shrink-0"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className={`min-w-0 h-full min-h-0 ${fill ? "" : "overflow-auto"}`}>
        {section === "sync" && <DatabasePanel />}
        {section === "gene" && <DerivedDataSection />}
        {section === "activity" && <AuditPanel />}
        {section === "settings" && <SettingsPanel />}
        {section === "tables" && (
          <div className="h-full">
            <TableBrowser />
          </div>
        )}
        {section === "sql" && (
          <div className="h-full">
            <SqlConsole />
          </div>
        )}
      </div>
    </div>
  );
}

// Derived layer: evidence (view) + loci (table) + locus_evidence (view).
// The gene reference is built-in (no URL to configure). Pick the candidate-
// gene biotypes, then hit Rebuild — it saves the selection and rebuilds
// evidence / loci / locus_evidence from the current sources and mappings.
function DerivedDataSection() {
  const qc = useQueryClient();
  const session = useSyncSession();
  const settingsQ = useQuery({
    queryKey: ["pegasus-settings"],
    queryFn: getPegasusSettings,
  });
  const biotypesQ = useQuery({
    queryKey: ["gene-biotypes"],
    queryFn: listGeneBiotypes,
  });

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RebuildDerivedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const biotypes = biotypesQ.data ?? [];
  const loaded = biotypes.length > 0;

  // Selection: chosen biotypes; empty = all (no filter), per the setting.
  // Local until Rebuild commits it.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  useEffect(() => {
    const persisted = (settingsQ.data?.candidate_gene_biotypes ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSelection(new Set(persisted));
  }, [settingsQ.data?.candidate_gene_biotypes]);

  const allMode = selection.size === 0;
  const isSelected = (bt: string) => allMode || selection.has(bt);

  const toggle = (bt: string) => {
    const next = new Set(allMode ? biotypes.map((b) => b.gene_type) : selection);
    if (next.has(bt)) next.delete(bt);
    else next.add(bt);
    if (next.size === biotypes.length) next.clear(); // full → all (no filter)
    setSelection(next);
  };
  const applyPreset = (codes: string[]) =>
    setSelection(new Set(codes.filter((c) => biotypes.some((b) => b.gene_type === c))));

  const presetActive = (codes: string[]) =>
    codes.length === 0
      ? allMode
      : !allMode &&
        codes.length === selection.size &&
        codes.every((c) => selection.has(c));

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const value = selection.size === 0 ? "" : Array.from(selection).join(",");
      await updatePegasusSettings({ candidate_gene_biotypes: value });
      void qc.invalidateQueries({ queryKey: ["pegasus-settings"] });
      const r = await rebuildDerived(session?.login ?? null);
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["audit-recent"] });
      void qc.invalidateQueries({ queryKey: ["gene-biotypes"] });
      void qc.invalidateQueries({ queryKey: ["explore"] });
      void qc.invalidateQueries({ queryKey: ["landing-stats"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-base-content/60">Gene reference</h2>
      <p className="text-xs text-base-content/50">
        Candidate genes come from the built-in{" "}
        <span className="font-medium">GENCODE</span> hg38 gene reference. Choose
        which biotypes count as a locus's candidate genes, then Save to apply
        (rebuilds <span className="font-mono">evidence</span>,{" "}
        <span className="font-mono">loci</span>, and{" "}
        <span className="font-mono">locus_evidence</span>).
      </p>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-base-content/70">
            Candidate gene biotypes
          </span>
          <div className="inline-flex bg-base-200 rounded-md p-0.5 text-xs">
            {BIOTYPE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.codes)}
                className={`px-2 py-0.5 rounded-md cursor-pointer ${
                  presetActive(p.codes)
                    ? "bg-base-100 text-base-content font-medium shadow-sm"
                    : "text-base-content/60 hover:text-base-content"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {loaded ? (
          <div className="border border-base-300 rounded-md p-2 grid grid-cols-2 gap-x-3 gap-y-1">
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
            {busy
              ? "Loading the gene reference…"
              : "Rebuild to load the gene reference, then pick biotypes here."}
          </p>
        )}
      </div>

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
        Save
      </button>

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
    </div>
  );
}
