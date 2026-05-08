import { BookOpen, MapPin, Users } from "lucide-react";
import type { V2fStudyConfig } from "../../api/types";

interface Props {
  study: V2fStudyConfig;
}

export function StudyDetail({ study }: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">{study.id_prefix}</h2>
        <div className="flex flex-wrap gap-3 mt-2 text-sm text-base-content/60">
          {study.gwas_source && (
            <span className="flex items-center gap-1">
              <BookOpen className="size-3.5" />
              {study.gwas_source}
            </span>
          )}
          {study.ancestry && (
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {study.ancestry}
            </span>
          )}
          {study.sample_size && (
            <span>N = {study.sample_size.toLocaleString()}</span>
          )}
          {study.doi && <span>DOI: {study.doi}</span>}
          {study.year && <span>{study.year}</span>}
        </div>
      </div>

      {/* Traits */}
      <section>
        <h3 className="text-sm font-medium text-base-content/60 mb-3">
          Traits ({study.traits.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {study.traits.map((trait) => (
            <span key={trait} className="badge badge-outline">
              {trait}
            </span>
          ))}
        </div>
      </section>

      {/* Loci source */}
      <section>
        <h3 className="text-sm font-medium text-base-content/60 mb-3 flex items-center gap-1.5">
          <MapPin className="size-4" />
          Loci Source
        </h3>
        <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
          <div className="px-4 py-3 text-sm space-y-1 text-base-content/70">
            {study.loci_source && (
              <p className="truncate" title={study.loci_source}>
                <span className="text-base-content/50">Source:</span> {study.loci_source}
              </p>
            )}
            {study.loci_sheet && (
              <p><span className="text-base-content/50">Sheet:</span> {study.loci_sheet}</p>
            )}
            {study.loci_skip ? (
              <p><span className="text-base-content/50">Skip:</span> {study.loci_skip} rows</p>
            ) : null}
            {study.gene_column && (
              <p><span className="text-base-content/50">Gene column:</span> {study.gene_column}</p>
            )}
            {study.sentinel_column && (
              <p><span className="text-base-content/50">Sentinel column:</span> {study.sentinel_column}</p>
            )}
            {study.pvalue_column && (
              <p><span className="text-base-content/50">P-value column:</span> {study.pvalue_column}</p>
            )}
          </div>
        </div>
      </section>

      {/* Transforms (if any) */}
      {study.transformations && study.transformations.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-base-content/60 mb-3">
            Transforms ({study.transformations.length})
          </h3>
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
            {study.transformations.map((t, i) => (
              <div
                key={i}
                className={`px-4 py-2 text-sm font-mono ${i > 0 ? "border-t border-base-300" : ""}`}
              >
                {t.type}
                {t.column ? `(${t.column})` : ""}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
