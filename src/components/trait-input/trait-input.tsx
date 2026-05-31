// TraitInput — combobox for picking trait associations. Used wherever a
// trait gets entered: source/study create forms, evidence routing
// editors, the eventual /traits page.
//
// Flow:
//   1. User types — local matches from config.traits show first (instant)
//   2. After a short debounce, OLS results show below "From ontologies"
//   3. Picking a local trait adds its trait_id to the value
//   4. Picking an OLS result calls upsertTrait to create the
//      config.traits row, returns the new id, then kicks off
//      enrichTrait in the background to fill description / synonyms /
//      hierarchy / xrefs / OT phenotypes (for diseases).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Search, Loader2 } from "lucide-react";
import { listTraits, upsertTrait } from "../../data/traitOps";
import { search as olsSearch, type OlsSearchResult } from "../../data/ontology/ols";
import { enrichTrait } from "../../data/ontology/enrich";
import { useSyncSession } from "../../hooks/useSyncSession";
import type { ConfigTrait } from "../../api/types";

export interface TraitInputProps {
  /** Selected trait ids. */
  value: string[];
  onChange: (next: string[]) => void;
  /** When false, picking a new trait replaces the current selection. */
  multiple?: boolean;
  placeholder?: string;
  /** Restrict OLS search to these ontologies (default: efo/mondo/hpo/orphanet). */
  ontologies?: string[];
}

const DEBOUNCE_MS = 250;

export function TraitInput({
  value,
  onChange,
  multiple = true,
  placeholder = "Search traits…",
  ontologies,
}: TraitInputProps) {
  const qc = useQueryClient();
  const session = useSyncSession();
  const actor = session?.login ?? null;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [olsLoading, setOlsLoading] = useState(false);
  const [olsResults, setOlsResults] = useState<OlsSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // All known local traits — used both for the selected-chip labels and
  // for the local autocomplete list. Cached forever; invalidated when
  // we upsert.
  const traitsQ = useQuery({
    queryKey: ["traits"],
    queryFn: listTraits,
    staleTime: Infinity,
  });
  const allTraits = traitsQ.data ?? [];
  const byId = useMemo(() => {
    const map = new Map<string, ConfigTrait>();
    for (const t of allTraits) map.set(t.id, t);
    return map;
  }, [allTraits]);

  // Debounce the query — OLS calls are network-bound, no point firing
  // them on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Run OLS search on the debounced query. Fires only when we have at
  // least 2 chars and the dropdown's open.
  useEffect(() => {
    if (!open || debounced.length < 2) {
      setOlsResults([]);
      setOlsLoading(false);
      return;
    }
    let cancelled = false;
    setOlsLoading(true);
    olsSearch(debounced, { ontologies, rows: 12 })
      .then((res) => {
        if (cancelled) return;
        setOlsResults(res);
      })
      .catch(() => {
        if (!cancelled) setOlsResults([]);
      })
      .finally(() => {
        if (!cancelled) setOlsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open, ontologies]);

  // Filter local traits by query string (case-insensitive substring).
  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTraits.slice(0, 10);
    return allTraits
      .filter((t) => {
        if (value.includes(t.id)) return false; // hide already-picked
        if (t.label.toLowerCase().includes(q)) return true;
        if (t.synonyms?.some((s) => s.toLowerCase().includes(q))) return true;
        if (t.primary_ontology_id?.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 10);
  }, [allTraits, query, value]);

  // OLS results minus ones we already have as local traits (matched by
  // primary_ontology_id), so we don't show "create" suggestions for
  // terms already in the DB.
  const olsToShow = useMemo(() => {
    const localOntIds = new Set(
      allTraits
        .filter((t) => t.primary_ontology_id)
        .map((t) => t.primary_ontology_id),
    );
    return olsResults.filter((r) => !localOntIds.has(r.obo_id));
  }, [olsResults, allTraits]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (traitId: string) => {
    const next = multiple
      ? value.includes(traitId)
        ? value
        : [...value, traitId]
      : [traitId];
    onChange(next);
    setQuery("");
    if (!multiple) setOpen(false);
    inputRef.current?.focus();
  };

  const pickOls = async (r: OlsSearchResult) => {
    // Upsert a config.traits row with the primary ontology mapping, then
    // pick it. Enrichment runs after so the UI isn't blocked waiting
    // for OT.
    try {
      const traitId = await upsertTrait({
        label: r.label,
        primary_ontology: r.ontology,
        primary_ontology_id: r.obo_id,
        ontology_label: r.label,
        description: r.description,
        synonyms: r.synonyms,
      }, actor);
      await qc.invalidateQueries({ queryKey: ["traits"] });
      pick(traitId);
      // Fire-and-forget Stage 1 + 2 enrichment. Errors are swallowed
      // inside enrichTrait — the trait is already usable without it.
      void enrichTrait(traitId, actor).then(() =>
        qc.invalidateQueries({ queryKey: ["traits"] }),
      );
    } catch (err) {
      console.error("Failed to create trait from OLS:", err);
    }
  };

  const remove = (traitId: string) => {
    onChange(value.filter((id) => id !== traitId));
  };

  const selectedChips = value.map((id) => {
    const t = byId.get(id);
    if (!t) return null;
    return (
      <span
        key={id}
        className="badge badge-outline badge-sm gap-1 pr-1"
        title={
          t.primary_ontology_id
            ? `${t.label} (${t.primary_ontology_id})`
            : t.label + " (unmapped)"
        }
      >
        <span className="truncate max-w-[14ch]">{t.label}</span>
        {t.primary_ontology_id && (
          <span className="text-[10px] text-base-content/50 font-mono">
            {t.primary_ontology_id}
          </span>
        )}
        <button
          type="button"
          className="hover:text-error"
          onClick={() => remove(id)}
          title="Remove"
        >
          ×
        </button>
      </span>
    );
  });

  return (
    <div className="trait-input" ref={containerRef}>
      <div className="flex flex-wrap gap-1.5 mb-1.5">{selectedChips}</div>
      <div className="relative">
        <label className="input input-bordered input-sm flex items-center gap-1.5 w-full">
          <Search className="size-3.5 text-base-content/40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="grow"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {olsLoading && (
            <Loader2 className="size-3 animate-spin text-base-content/40" />
          )}
          {query && (
            <button
              type="button"
              className="text-base-content/30 hover:text-base-content"
              onClick={() => setQuery("")}
            >
              <X className="size-3" />
            </button>
          )}
        </label>

        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-80 overflow-y-auto">
            {localMatches.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-base-content/40">
                  In your database
                </div>
                {localMatches.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-base-200 flex items-center gap-2"
                    onClick={() => pick(t.id)}
                  >
                    <span className="text-sm flex-1 truncate">{t.label}</span>
                    {t.primary_ontology_id ? (
                      <span className="text-[10px] font-mono text-base-content/40">
                        {t.primary_ontology_id}
                      </span>
                    ) : (
                      <span className="text-[10px] text-base-content/30 italic">
                        unmapped
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {olsToShow.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-base-content/40 border-t border-base-300">
                  From ontologies
                </div>
                {olsToShow.map((r) => (
                  <button
                    key={`${r.ontology}_${r.obo_id}`}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-base-200"
                    onClick={() => void pickOls(r)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{r.label}</span>
                      <span className="text-[10px] font-mono text-base-content/40">
                        {r.obo_id}
                      </span>
                    </div>
                    {r.description && (
                      <div className="text-xs text-base-content/50 truncate">
                        {r.description}
                      </div>
                    )}
                  </button>
                ))}
              </>
            )}

            {!olsLoading &&
              localMatches.length === 0 &&
              olsToShow.length === 0 && (
                <div className="px-3 py-3 text-sm text-base-content/40">
                  {debounced.length < 2
                    ? "Start typing to search…"
                    : "No matches found."}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
