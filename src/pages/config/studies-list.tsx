// Phase 6 — Studies tab.
//
// Filtered view of sources that define loci (≥1 loci_definition
// derivation), surfacing citation metadata as columns. Clicking a row
// opens the existing source detail editor. Read-only projection — see
// data/studyOps.ts.

import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { listStudies, type Study } from "../../data/studyOps";

export function StudiesList({
  onOpen,
}: {
  onOpen: (sourceName: string) => void;
}) {
  const q = useQuery({ queryKey: ["config", "studies"], queryFn: listStudies });
  const studies = q.data ?? [];

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-semibold">Studies</h1>
        <span className="text-sm text-base-content/40">
          {studies.length} stud{studies.length === 1 ? "y" : "ies"} ·
          sources that define loci
        </span>
      </div>

      {q.isLoading ? (
        <div className="text-sm text-base-content/40">Loading studies…</div>
      ) : studies.length === 0 ? (
        <div className="border border-dashed border-base-300 rounded-lg p-8 text-center text-sm text-base-content/60">
          No studies yet. A source becomes a study when it has a
          derivation with role <code>loci_definition</code> (set in the
          source detail editor).
        </div>
      ) : (
        <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
          {studies.map((s, i) => (
            <StudyRow
              key={s.id}
              study={s}
              first={i === 0}
              onClick={() => onOpen(s.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StudyRow({
  study,
  first,
  onClick,
}: {
  study: Study;
  first: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-base-200/40 transition-colors ${
        first ? "" : "border-t border-base-300"
      }`}
    >
      <FlaskConical className="size-4 text-base-content/40 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {study.display_name ?? study.name}
          </span>
          {study.gwas_source && (
            <span className="badge badge-xs badge-ghost">
              {study.gwas_source}
            </span>
          )}
        </div>
        <div className="text-xs text-base-content/50 flex gap-2 items-center mt-0.5 flex-wrap">
          <code className="font-mono">{study.name}</code>
          <span>·</span>
          <span>
            {study.loci_derivations} loci-def derivation
            {study.loci_derivations === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span className={study.locus_count == null ? "italic" : ""}>
            {study.locus_count == null
              ? "not built"
              : `${study.locus_count.toLocaleString()} loci`}
          </span>
          {study.ancestry && (
            <>
              <span>·</span>
              <span>{study.ancestry}</span>
            </>
          )}
          {study.sample_size != null && (
            <>
              <span>·</span>
              <span>N={study.sample_size.toLocaleString()}</span>
            </>
          )}
          {study.year != null && (
            <>
              <span>·</span>
              <span>{study.year}</span>
            </>
          )}
          {study.doi && (
            <>
              <span>·</span>
              <a
                href={`https://doi.org/${study.doi}`}
                target="_blank"
                rel="noreferrer"
                className="link link-hover text-base-content/60"
                onClick={(e) => e.stopPropagation()}
              >
                DOI
              </a>
            </>
          )}
          {study.pubmed_id && (
            <>
              <span>·</span>
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${study.pubmed_id}/`}
                target="_blank"
                rel="noreferrer"
                className="link link-hover text-base-content/60"
                onClick={(e) => e.stopPropagation()}
              >
                PMID {study.pubmed_id}
              </a>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
