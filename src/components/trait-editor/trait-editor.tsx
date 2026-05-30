// Admin editor for a single trait's ontology mapping + kind. Opened from the
// pencil in the trait content header (signed-in users only). Label is
// read-only (source-assigned); description is ontology-sourced and changes
// only via the mapping. See plan 2026-05-30-trait-metadata-editor.md.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Search, Loader2, Trash2, RefreshCw, Check, ChevronDown } from "lucide-react";
import { getTrait } from "../../data/traitOps";
import {
  setTraitMapping,
  clearTraitMapping,
  setTraitKind,
  type TraitKind,
} from "../../data/traitMetadata";
import { enrichTrait } from "../../data/ontology/enrich";
import { search as olsSearch, type OlsSearchResult } from "../../data/ontology/ols";
import { useSyncSession } from "../../hooks/useSyncSession";

const KIND_OPTIONS: { value: TraitKind | "auto"; label: string }[] = [
  { value: "auto", label: "Auto (inferred)" },
  { value: "measurement", label: "Measurement" },
  { value: "disease", label: "Disease" },
  { value: "phenotype", label: "Phenotype" },
  { value: "other", label: "Other" },
];

export function TraitEditor({
  traitId,
  onClose,
}: {
  traitId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const session = useSyncSession();
  const actor = session?.login ?? null;

  const traitQ = useQuery({
    queryKey: ["traits", "detail", traitId],
    queryFn: () => getTrait(traitId),
    enabled: !!traitId,
  });
  const trait = traitQ.data;

  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OlsSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Invalidate everything that renders trait metadata after a write.
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["traits"] }),
      qc.invalidateQueries({ queryKey: ["explore", "trait", traitId] }),
      // Trait metadata is part of the published snapshot — refresh the dirty
      // indicator (keyed under ["config", "dirty-state"]).
      qc.invalidateQueries({ queryKey: ["config"] }),
    ]);
  };

  // Debounced OLS search (2+ chars).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      olsSearch(q, { rows: 8 })
        .then((r) => setResults(r))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      console.error("Trait edit failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const onPick = (r: OlsSearchResult) =>
    run(async () => {
      await setTraitMapping(traitId, r, actor);
      setQuery("");
      setResults([]);
    });

  const kindValue: TraitKind | "auto" = trait?.trait_kind_overridden
    ? (trait.trait_kind ?? "auto")
    : "auto";

  const enrichmentRows = useMemo(() => {
    if (!trait) return [];
    return [
      ["Synonyms", trait.synonyms?.length ? trait.synonyms.join(", ") : "—"],
      ["Cross-refs", trait.xrefs?.length ? `${trait.xrefs.length}` : "—"],
      ["Hierarchy", trait.hierarchy_path?.length ? `${trait.hierarchy_path.length} levels` : "—"],
      ["OT phenotypes", trait.ot_phenotypes?.length ? `${trait.ot_phenotypes.length}` : "—"],
      ["OT drugs", trait.ot_drugs?.length ? `${trait.ot_drugs.length}` : "—"],
      ["Last enriched", trait.last_enriched_at ? new Date(trait.last_enriched_at).toLocaleString() : "never"],
    ] as const;
  }, [trait]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-xl">
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <h2 className="text-sm font-semibold">Edit trait</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-base-content/50 hover:text-base-content cursor-pointer disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Label — read-only */}
          <div>
            <div className="text-xs font-medium text-base-content/50 mb-1">Label</div>
            <div className="text-sm font-medium">{trait?.label ?? traitId}</div>
          </div>

          {/* Ontology mapping */}
          <div>
            <div className="text-xs font-medium text-base-content/50 mb-1">
              Ontology mapping
            </div>
            {trait?.primary_ontology_id ? (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{trait.ontology_label ?? trait.label}</span>
                <span className="font-mono text-xs text-base-content/40">
                  {trait.primary_ontology}:{trait.primary_ontology_id}
                </span>
                <button
                  type="button"
                  onClick={() => run(() => clearTraitMapping(traitId, actor))}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-error/80 hover:text-error cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" /> Clear
                </button>
              </div>
            ) : (
              <div className="text-sm text-base-content/40 mb-2">Unmapped</div>
            )}

            {/* OLS search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
                placeholder="Search EFO / MONDO / HPO to map…"
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-base-300 bg-base-100 focus:outline-none focus:border-primary disabled:opacity-50"
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-base-content/40" />
              )}
            </div>
            {results.length > 0 && (
              <ul className="mt-1 border border-base-300 rounded-md divide-y divide-base-200 overflow-hidden">
                {results.map((r) => (
                  <li key={`${r.ontology}:${r.obo_id}`}>
                    <button
                      type="button"
                      onClick={() => onPick(r)}
                      disabled={busy}
                      className="w-full text-left px-3 py-2 hover:bg-base-200 disabled:opacity-50 cursor-pointer"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm">{r.label}</span>
                        <span className="font-mono text-xs text-base-content/40">{r.obo_id}</span>
                      </div>
                      {r.description && (
                        <p className="text-xs text-base-content/50 truncate">{r.description}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Trait kind */}
          <div>
            <label className="text-xs font-medium text-base-content/50 mb-1 block">
              Trait kind
            </label>
            <div className="relative">
              <select
                value={kindValue}
                disabled={busy}
                onChange={(e) =>
                  run(() =>
                    setTraitKind(traitId, e.target.value as TraitKind | "auto", actor),
                  )
                }
                className="w-full appearance-none pl-2.5 pr-9 py-1.5 text-sm rounded-md border border-base-300 bg-base-100 focus:outline-none focus:border-primary disabled:opacity-50"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
            </div>
            {trait?.trait_kind_overridden && (
              <p className="text-xs text-base-content/40 mt-0.5 inline-flex items-center gap-1">
                <Check className="size-3" /> Overridden — kept through re-enrichment.
              </p>
            )}
          </div>

          {/* Enrichment (read-only) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-medium text-base-content/50">Enrichment</div>
              <button
                type="button"
                onClick={() => run(() => enrichTrait(traitId).then(() => undefined))}
                disabled={busy || !trait?.primary_ontology_id}
                title={trait?.primary_ontology_id ? "Re-pull from OLS / OXO / OpenTargets" : "Map an ontology term first"}
                className="inline-flex items-center gap-1 text-xs text-base-content/60 hover:text-base-content cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            <dl className="text-xs rounded-md border border-base-300 divide-y divide-base-200">
              {enrichmentRows.map(([k, v]) => (
                <div key={k} className="flex gap-3 px-3 py-1.5">
                  <dt className="text-base-content/50 w-28 shrink-0">{k}</dt>
                  <dd className="text-base-content/80 truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
