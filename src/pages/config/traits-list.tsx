// Phase 5 chunk 1 — config.traits management list.
//
// Lists every canonical trait with its ontology-mapping + enrichment
// status. Distinct from the genomics /traits/:trait page (that's loci
// + genome track for a phenotype); this is the config-side entity
// inventory. Rows are selectable → trait detail panel (chunk 2).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Loader2 } from "lucide-react";
import { listTraits, pruneJunkTraits } from "../../data/traitOps";
import type { ConfigTrait } from "../../api/types";

type Filter = "all" | "mapped" | "unmapped";

const KIND_BADGE: Record<string, string> = {
  measurement: "badge-info",
  disease: "badge-error",
  phenotype: "badge-warning",
  other: "badge-ghost",
};

export function TraitsList({
  onSelect,
}: {
  onSelect?: (traitId: string) => void;
}) {
  const qc = useQueryClient();
  const traitsQ = useQuery({ queryKey: ["config", "traits"], queryFn: listTraits });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  const prune = async () => {
    setPruneMsg(null);
    setPruning(true);
    try {
      const removed = await pruneJunkTraits();
      setPruneMsg(
        removed === 0
          ? "No junk traits to prune."
          : `Pruned ${removed} unreferenced, unmapped trait${removed === 1 ? "" : "s"}.`,
      );
      await qc.invalidateQueries({ queryKey: ["config", "traits"] });
      await traitsQ.refetch();
    } catch (err) {
      setPruneMsg(
        `Prune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPruning(false);
    }
  };

  const traits = traitsQ.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return traits.filter((t) => {
      const mapped = Boolean(t.primary_ontology_id);
      if (filter === "mapped" && !mapped) return false;
      if (filter === "unmapped" && mapped) return false;
      if (!q) return true;
      if (t.label.toLowerCase().includes(q)) return true;
      if (t.primary_ontology_id?.toLowerCase().includes(q)) return true;
      if (t.synonyms?.some((s) => s.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [traits, query, filter]);

  const mappedCount = traits.filter((t) => t.primary_ontology_id).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-sm text-base-content/40">
          {traits.length} trait{traits.length === 1 ? "" : "s"} ·{" "}
          {mappedCount} mapped · {traits.length - mappedCount} unmapped
        </span>
        <div className="flex-1" />
        <div className="join">
          {(["all", "mapped", "unmapped"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn btn-xs join-item ${
                filter === f ? "btn-primary" : "btn-ghost"
              }`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="input input-bordered input-sm flex items-center gap-1.5 w-56">
          <Search className="size-3.5 text-base-content/40 shrink-0" />
          <input
            type="text"
            className="grow"
            placeholder="Search label / ID / synonym"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-xs btn-ghost text-error gap-1"
          onClick={() => void prune()}
          disabled={pruning}
          title="Delete unreferenced, unmapped traits (junk from bad builds)"
        >
          {pruning ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Trash2 className="size-3" />
          )}
          Prune junk
        </button>
      </div>

      {pruneMsg && (
        <div
          role="status"
          className="alert alert-info text-sm mb-4 py-2"
        >
          <span>{pruneMsg}</span>
        </div>
      )}

      {traitsQ.isLoading ? (
        <div className="text-sm text-base-content/40">Loading traits…</div>
      ) : traits.length === 0 ? (
        <div className="border border-dashed border-base-300 rounded-lg p-8 text-center text-sm text-base-content/60">
          No traits yet. Traits are created when you pick them in the Add Data
          wizard / source editor, or auto-created from a per-row trait column
          on build.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-base-content/40 py-6 text-center">
          No traits match.
        </div>
      ) : (
        <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
          {filtered.map((t, i) => (
            <TraitRow
              key={t.id}
              trait={t}
              first={i === 0}
              onClick={onSelect ? () => onSelect(t.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TraitRow({
  trait,
  first,
  onClick,
}: {
  trait: ConfigTrait;
  first: boolean;
  onClick?: () => void;
}) {
  const mapped = Boolean(trait.primary_ontology_id);
  const enriched = Boolean(trait.last_enriched_at);
  const body = (
    <>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{trait.label}</span>
          {trait.trait_kind && (
            <span
              className={`badge badge-xs ${
                KIND_BADGE[trait.trait_kind] ?? "badge-ghost"
              }`}
            >
              {trait.trait_kind}
            </span>
          )}
          {!mapped && (
            <span className="badge badge-xs badge-ghost text-base-content/40">
              unmapped
            </span>
          )}
        </div>
        <div className="text-xs text-base-content/50 flex gap-2 items-center mt-0.5">
          {mapped ? (
            <code className="font-mono">{trait.primary_ontology_id}</code>
          ) : (
            <span className="italic">no ontology mapping</span>
          )}
          {trait.synonyms && trait.synonyms.length > 0 && (
            <>
              <span>·</span>
              <span>{trait.synonyms.length} synonyms</span>
            </>
          )}
          <span>·</span>
          <span className={enriched ? "" : "text-base-content/30"}>
            {enriched ? "enriched" : "not enriched"}
          </span>
        </div>
      </div>
    </>
  );
  const cls = `w-full text-left flex items-center gap-3 px-4 py-2.5 ${
    first ? "" : "border-t border-base-300"
  } ${onClick ? "hover:bg-base-200/40 transition-colors" : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
