// Phase 5 chunk 2 — trait detail panel.
//
// Renders one config.traits row: ontology mapping, enrichment data
// (description / synonyms / hierarchy / xrefs, and OT phenotypes +
// drugs + therapeutic areas for disease traits), and a "used by" list
// of the sources/derivations that reference it. A single-trait
// "Refresh enrichment" button re-runs the Phase 2a pipeline; the
// batch versions land in chunk 3.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { getTrait, getTraitUsage } from "../../data/traitOps";
import { enrichTrait } from "../../data/ontology/enrich";
import { Loading, ErrorAlert } from "../../components/loading";

interface Props {
  traitId: string;
  onBack: () => void;
}

export function TraitDetailPanel({ traitId, onBack }: Props) {
  const qc = useQueryClient();
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [enrichErr, setEnrichErr] = useState<string | null>(null);

  const traitQ = useQuery({
    queryKey: ["config", "trait", traitId],
    queryFn: () => getTrait(traitId),
  });
  const usageQ = useQuery({
    queryKey: ["config", "trait-usage", traitId],
    queryFn: () => getTraitUsage(traitId),
  });

  if (traitQ.isLoading) return <Loading />;
  if (traitQ.error) return <ErrorAlert message={traitQ.error.message} />;
  if (!traitQ.data) return <ErrorAlert message="Trait not found" />;

  const t = traitQ.data;
  const usage = usageQ.data;
  const mapped = Boolean(t.primary_ontology_id);
  const isDisease = t.trait_kind === "disease";

  const refresh = async () => {
    setEnrichErr(null);
    setEnrichMsg(null);
    setEnriching(true);
    try {
      const r = await enrichTrait(traitId);
      const parts: string[] = [];
      if (r.stage1_ok) parts.push("ontology details");
      if (r.stage2_ok) parts.push("OpenTargets");
      if (r.stage2_skipped && !r.stage2_ok) parts.push("(OT skipped)");
      setEnrichMsg(
        parts.length ? `Refreshed: ${parts.join(", ")}.` : "Nothing to refresh (trait is unmapped).",
      );
      await qc.invalidateQueries({ queryKey: ["config", "trait", traitId] });
      await qc.invalidateQueries({ queryKey: ["config", "traits"] });
      await traitQ.refetch();
    } catch (err) {
      setEnrichErr(err instanceof Error ? err.message : String(err));
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content"
      >
        <ArrowLeft className="size-3.5" />
        Traits
      </button>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{t.label}</h1>
            {t.trait_kind && (
              <span className="badge badge-sm badge-outline">
                {t.trait_kind}
              </span>
            )}
          </div>
          <div className="text-xs text-base-content/50 mt-1 flex flex-wrap gap-2 items-center">
            {mapped ? (
              <>
                <code className="font-mono">{t.primary_ontology_id}</code>
                {t.ontology_label && t.ontology_label !== t.label && (
                  <span>· {t.ontology_label}</span>
                )}
                {t.ontology_version && <span>· {t.ontology_version}</span>}
              </>
            ) : (
              <span className="italic">unmapped (no ontology term)</span>
            )}
            {t.last_enriched_at && (
              <span>· enriched {t.last_enriched_at.slice(0, 10)}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost gap-1"
          onClick={refresh}
          disabled={enriching || !mapped}
          title={mapped ? "Re-run OLS/OXO/OT enrichment" : "Map an ontology term first"}
        >
          {enriching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh enrichment
        </button>
      </div>

      {enrichMsg && (
        <div role="status" className="alert alert-success text-sm">
          <span>{enrichMsg}</span>
        </div>
      )}
      {enrichErr && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{enrichErr}</span>
        </div>
      )}

      {t.description && (
        <Section title="Description">
          <p className="text-sm text-base-content/70">{t.description}</p>
        </Section>
      )}

      {t.synonyms && t.synonyms.length > 0 && (
        <Section title="Synonyms">
          <div className="flex flex-wrap gap-1.5">
            {t.synonyms.map((s) => (
              <span key={s} className="badge badge-sm badge-ghost">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      {t.hierarchy_path && t.hierarchy_path.length > 0 && (
        <Section title="Hierarchy">
          <div className="text-sm text-base-content/60 flex flex-wrap items-center gap-1.5">
            {t.hierarchy_path.map((n, i) => (
              <span key={n.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-base-content/30">→</span>}
                <span title={n.id}>{n.label}</span>
              </span>
            ))}
            <span className="text-base-content/30">→</span>
            <span className="font-medium text-base-content/80">{t.label}</span>
          </div>
        </Section>
      )}

      {t.xrefs && t.xrefs.length > 0 && (
        <Section title="Cross-references">
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
            <table className="table table-xs">
              <tbody>
                {t.xrefs.map((x) => (
                  <tr key={`${x.onto}:${x.id}`}>
                    <td className="font-medium w-24">{x.onto}</td>
                    <td className="font-mono">{x.id}</td>
                    <td className="text-base-content/50">{x.label ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {isDisease &&
        t.ot_therapeutic_areas &&
        t.ot_therapeutic_areas.length > 0 && (
          <Section title="Therapeutic areas (OpenTargets)">
            <div className="flex flex-wrap gap-1.5">
              {t.ot_therapeutic_areas.map((a) => (
                <span key={a} className="badge badge-sm badge-outline">
                  {a}
                </span>
              ))}
            </div>
          </Section>
        )}

      {isDisease && t.ot_phenotypes && t.ot_phenotypes.length > 0 && (
        <Section
          title={`Signs & symptoms (${t.ot_phenotypes.length}, via OpenTargets/HPO)`}
        >
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden max-h-72 overflow-y-auto">
            <table className="table table-xs">
              <thead>
                <tr className="text-base-content/40">
                  <th>Phenotype</th>
                  <th>HPO</th>
                  <th>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {t.ot_phenotypes.map((p) => (
                  <tr key={p.hpo_id}>
                    <td>{p.label}</td>
                    <td className="font-mono text-[11px]">{p.hpo_id}</td>
                    <td className="text-base-content/50">
                      {p.frequency ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {isDisease && t.ot_drugs && t.ot_drugs.length > 0 && (
        <Section title={`Known drugs (${t.ot_drugs.length}, via OpenTargets)`}>
          <div className="border border-base-300 rounded-lg bg-base-100 overflow-hidden max-h-72 overflow-y-auto">
            <table className="table table-xs">
              <thead>
                <tr className="text-base-content/40">
                  <th>Drug</th>
                  <th>Max phase</th>
                  <th>Mechanism</th>
                </tr>
              </thead>
              <tbody>
                {t.ot_drugs.map((d) => (
                  <tr key={d.chembl_id}>
                    <td>{d.name}</td>
                    <td>{d.max_phase ?? ""}</td>
                    <td className="text-base-content/50">
                      {d.mechanism_of_action ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Used by */}
      <Section title="Used by">
        {usageQ.isLoading ? (
          <div className="text-sm text-base-content/40">Loading…</div>
        ) : !usage ||
          (usage.sources.length === 0 && usage.derivations.length === 0) ? (
          <p className="text-sm text-base-content/40 italic">
            Not referenced by any source or derivation yet.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            {usage.sources.length > 0 && (
              <div>
                <div className="text-xs font-medium text-base-content/50 mb-1">
                  Declared on sources
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {usage.sources.map((s) => (
                    <span
                      key={s.name}
                      className="badge badge-sm badge-outline"
                      title={s.name}
                    >
                      {s.display_name ?? s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {usage.derivations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-base-content/50 mb-1">
                  Constant trait on derivations
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {usage.derivations.map((d) => (
                    <span
                      key={d.source_tag}
                      className="badge badge-sm badge-ghost font-mono text-[11px]"
                    >
                      {d.source_tag} · {d.evidence_category}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* External links when mapped */}
      {mapped && t.primary_ontology_id && (
        <Section title="External">
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="link link-primary inline-flex items-center gap-1"
              href={`https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(
                t.primary_ontology_id,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              OLS <ExternalLink className="size-3" />
            </a>
            {isDisease && (
              <a
                className="link link-primary inline-flex items-center gap-1"
                href={`https://platform.opentargets.org/disease/${encodeURIComponent(
                  t.primary_ontology_id,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Open Targets <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-medium text-base-content/60 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}
