// Source detail editor — Phase 4 of the web-first config redesign.
//
// Replaces the old V2fSourceConfig-based source-detail.tsx. Shows a
// single source's metadata + optional citation + declared traits +
// list of derivations. Each derivation can be edited inline; new ones
// can be added via "+ Add derivation". Rebuild triggers buildSource.
//
// Column-aware fields (mappings, trait_column, transform column-refs)
// pull from main.raw_<source_id> when the source has been built at
// least once; otherwise fall back to plain text input.

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Database,
  FlaskConical,
  Hammer,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  getSource,
  updateSource,
  removeSource,
  rawTableName,
} from "../../data/sourceOps";
import {
  insertDerivation,
  listDerivationsForSource,
  removeDerivation,
  updateDerivation,
} from "../../data/derivationOps";
import { buildSource } from "../../data/pipeline/build";
import { getDataSource } from "../../data/select";
import {
  sourceCitationSchema,
  sourceConfigSchema,
} from "../../data/config-schema/source";
import { SchemaForm } from "../../components/schema-form/schema-form";
import { TraitInput } from "../../components/trait-input";
import { Loading, ErrorAlert } from "../../components/loading";
import { DerivationCard } from "./derivation-card";
import type { FormState } from "../../components/schema-form/types";
import type {
  ConfigDerivation,
  ConfigSource,
  SourceCitation,
} from "../../api/types";

interface Props {
  sourceName: string;
  onBack: () => void;
}

export function SourceDetailEditor({ sourceName, onBack }: Props) {
  const qc = useQueryClient();
  const sourceQ = useQuery({
    queryKey: ["config", "source", sourceName],
    queryFn: () => getSource(sourceName),
  });
  const derivationsQ = useQuery({
    queryKey: ["config", "derivations", sourceQ.data?.id ?? ""],
    queryFn: () => listDerivationsForSource(sourceQ.data!.id),
    enabled: !!sourceQ.data?.id,
  });

  if (sourceQ.isLoading) return <Loading />;
  if (sourceQ.error) return <ErrorAlert message={sourceQ.error.message} />;
  if (!sourceQ.data) return <ErrorAlert message={`Source '${sourceName}' not found`} />;

  const source = sourceQ.data;
  const derivations = derivationsQ.data ?? [];
  const isStudy = derivations.some((d) => d.role === "loci_definition");

  const refetch = async () => {
    await qc.invalidateQueries({ queryKey: ["config"] });
    await qc.invalidateQueries({ queryKey: ["traits"] });
    await sourceQ.refetch();
    await derivationsQ.refetch();
  };

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content"
      >
        <ArrowLeft className="size-3.5" />
        Sources
      </button>

      <SourceHeader source={source} isStudy={isStudy} onRefetch={refetch} />
      <MetadataCard source={source} onRefetch={refetch} />
      <CitationCard source={source} isStudy={isStudy} onRefetch={refetch} />
      <TraitsCard source={source} onRefetch={refetch} />
      <DerivationsSection
        source={source}
        derivations={derivations}
        loading={derivationsQ.isLoading}
        onRefetch={refetch}
      />
      <DangerZone source={source} onDeleted={onBack} />
    </div>
  );
}

// --- Header (name + build) ---

function SourceHeader({
  source,
  isStudy,
  onRefetch,
}: {
  source: ConfigSource;
  isStudy: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [building, setBuilding] = useState(false);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const build = async () => {
    setBuildError(null);
    setBuildMessage(null);
    setBuilding(true);
    try {
      const result = await buildSource(source.name);
      const rows = result.derivations.reduce((a, d) => a + d.rows, 0);
      const loci = result.loci.reduce((a, l) => a + l.loci, 0);
      setBuildMessage(
        `Built ${rows} evidence row${rows === 1 ? "" : "s"}${
          isStudy ? `, ${loci} loc${loci === 1 ? "us" : "i"}` : ""
        }.`,
      );
      await onRefetch();
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {isStudy ? (
          <FlaskConical className="size-5 text-base-content/40" />
        ) : (
          <Database className="size-5 text-base-content/40" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {source.display_name ?? source.name}
          </h1>
          <div className="text-xs text-base-content/50 flex gap-2 items-center mt-0.5">
            <code className="font-mono">{source.name}</code>
            <span>·</span>
            <span>{source.source_type}</span>
            {isStudy && (
              <>
                <span>·</span>
                <span>defines loci</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1"
          onClick={build}
          disabled={building}
        >
          {building ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Hammer className="size-3.5" />
          )}
          {building ? "Building…" : "Rebuild"}
        </button>
      </div>
      {buildMessage && (
        <div role="status" className="alert alert-success text-sm">
          <span>{buildMessage}</span>
        </div>
      )}
      {buildError && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{buildError}</span>
        </div>
      )}
    </div>
  );
}

// --- Metadata card (editable) ---

function MetadataCard({
  source,
  onRefetch,
}: {
  source: ConfigSource;
  onRefetch: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (state: FormState) => {
    setError(null);
    setBusy(true);
    try {
      await updateSource(source.name, {
        name: state.name as string,
        display_name: (state.display_name as string) || undefined,
        description: (state.description as string) || undefined,
        source_type: state.source_type as string,
        url: (state.url as string) || undefined,
        sheet: (state.sheet as string) || undefined,
        skip_rows: Number(state.skip_rows) || 0,
      });
      await onRefetch();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <section className="border border-base-300 rounded-lg bg-base-100 p-4 space-y-3">
        <div className="text-xs font-medium text-base-content/60 uppercase tracking-wider">
          Metadata
        </div>
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}
        <SchemaForm
          schema={sourceConfigSchema}
          initialValue={source as unknown as FormState}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(false)}
          submitLabel="Save"
          busy={busy}
        />
      </section>
    );
  }

  return (
    <section className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300">
        <span className="text-xs font-medium text-base-content/60 uppercase tracking-wider flex-1">
          Metadata
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
          Edit
        </button>
      </div>
      <div className="px-4 py-3 text-sm space-y-1 text-base-content/70">
        {source.display_name && (
          <p>
            <span className="text-base-content/50">Display name:</span>{" "}
            {source.display_name}
          </p>
        )}
        {source.description && (
          <p className="text-base-content/60">{source.description}</p>
        )}
        {source.url && (
          <p className="truncate">
            <span className="text-base-content/50">URL:</span>{" "}
            <a
              className="link link-primary"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.url}
            </a>
          </p>
        )}
        {source.sheet && (
          <p>
            <span className="text-base-content/50">Sheet:</span> {source.sheet}
          </p>
        )}
        {source.skip_rows ? (
          <p>
            <span className="text-base-content/50">Skip:</span>{" "}
            {source.skip_rows} rows
          </p>
        ) : null}
      </div>
    </section>
  );
}

// --- Citation card (editable, only when source has loci_definition) ---

function CitationCard({
  source,
  isStudy,
  onRefetch,
}: {
  source: ConfigSource;
  isStudy: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Citation only meaningfully applies to loci-defining sources.
  if (!isStudy && !source.citation) return null;

  const handleSubmit = async (state: FormState) => {
    setError(null);
    setBusy(true);
    try {
      const citation: Omit<SourceCitation, "source_id" | "updated_at"> = {};
      if (state.gwas_source) citation.gwas_source = state.gwas_source as string;
      if (state.ancestry) citation.ancestry = state.ancestry as string;
      if (state.sample_size != null && state.sample_size !== "") {
        citation.sample_size = Number(state.sample_size);
      }
      if (state.doi) citation.doi = state.doi as string;
      if (state.year != null && state.year !== "") {
        citation.year = Number(state.year);
      }
      if (state.pubmed_id) citation.pubmed_id = state.pubmed_id as string;
      await updateSource(source.name, { citation });
      await onRefetch();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <section className="border border-base-300 rounded-lg bg-base-100 p-4 space-y-3">
        <div className="text-xs font-medium text-base-content/60 uppercase tracking-wider">
          Citation
        </div>
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            <span>{error}</span>
          </div>
        )}
        <SchemaForm
          schema={sourceCitationSchema}
          initialValue={(source.citation ?? {}) as unknown as FormState}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(false)}
          submitLabel="Save"
          busy={busy}
        />
      </section>
    );
  }

  const c = source.citation;
  return (
    <section className="border border-base-300 rounded-lg bg-base-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300">
        <span className="text-xs font-medium text-base-content/60 uppercase tracking-wider flex-1">
          Citation
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3" />
          Edit
        </button>
      </div>
      <div className="px-4 py-3 text-sm space-y-1 text-base-content/70">
        {c?.gwas_source && <p>{c.gwas_source}</p>}
        <div className="flex flex-wrap gap-3 text-xs text-base-content/50">
          {c?.ancestry && <span>Ancestry: {c.ancestry}</span>}
          {c?.sample_size && <span>N = {c.sample_size.toLocaleString()}</span>}
          {c?.year && <span>{c.year}</span>}
          {c?.doi && <span>DOI: {c.doi}</span>}
          {c?.pubmed_id && <span>PMID: {c.pubmed_id}</span>}
        </div>
        {!c && (
          <p className="text-base-content/40 italic">No citation set yet.</p>
        )}
      </div>
    </section>
  );
}

// --- Declared traits card (TraitInput-backed) ---

function TraitsCard({
  source,
  onRefetch,
}: {
  source: ConfigSource;
  onRefetch: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (next: string[]) => {
    setError(null);
    setBusy(true);
    try {
      await updateSource(source.name, { trait_ids: next });
      await onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-base-300 rounded-lg bg-base-100 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-base-content/60 uppercase tracking-wider flex-1">
          Declared traits
        </span>
        {busy && <Loader2 className="size-3 animate-spin" />}
      </div>
      <p className="text-xs text-base-content/50">
        Traits this source's data covers. Drives the source stack badges and
        prefills new evidence derivations with constant trait scope.
      </p>
      <TraitInput
        value={source.trait_ids ?? []}
        onChange={(next) => void handleChange(next)}
        multiple
        placeholder="Search FEV1, asthma, …"
      />
      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}

// --- Derivations section ---

function DerivationsSection({
  source,
  derivations,
  loading,
  onRefetch,
}: {
  source: ConfigSource;
  derivations: ConfigDerivation[];
  loading: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const rawColumnsQ = useQuery({
    queryKey: ["raw-columns", source.id],
    queryFn: () => fetchRawColumns(source.id),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-base-content/60 flex-1">
          Derivations ({derivations.length})
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <Plus className="size-3" />
          Add derivation
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-base-content/40">Loading derivations…</div>
      ) : derivations.length === 0 && !adding ? (
        <div className="border border-dashed border-base-300 rounded-lg p-6 text-center text-sm text-base-content/50">
          No derivations yet. Click <strong>Add derivation</strong> to define
          how rows from this source map into the evidence schema.
        </div>
      ) : null}

      {derivations.map((d) => (
        <DerivationCard
          key={d.id}
          derivation={d}
          source={source}
          rawColumns={rawColumnsQ.data ?? []}
          onSave={async (patch) => {
            await updateDerivation(d.id, patch);
            await onRefetch();
          }}
          onRemove={async () => {
            await removeDerivation(d.id);
            await onRefetch();
          }}
        />
      ))}

      {adding && (
        <DerivationCard
          isNew
          source={source}
          rawColumns={rawColumnsQ.data ?? []}
          onCancel={() => setAdding(false)}
          onSave={async (patch) => {
            // The DerivationCard composes a full input object on save;
            // delegate to insertDerivation here.
            await insertDerivation({
              source_id: source.id,
              source_tag: patch.source_tag ?? `${source.name}__${patch.evidence_category}`,
              display_name: patch.display_name ?? undefined,
              role: patch.role!,
              evidence_category: patch.evidence_category!,
              centric: patch.centric!,
              trait_scope: patch.trait_scope!,
              mappings: patch.mappings,
              trait_ids: patch.trait_ids,
              trait_column: patch.trait_column ?? undefined,
            });
            await onRefetch();
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

// --- Danger zone ---

function DangerZone({
  source,
  onDeleted,
}: {
  source: ConfigSource;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await removeSource(source.name);
      await qc.invalidateQueries();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <section className="border border-error/30 rounded-lg bg-base-100 p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-error/80">Delete source</div>
          <div className="text-xs text-base-content/50">
            Drops every derivation, the raw table, and removes the source from
            config. Can't be undone.
          </div>
        </div>
        {confirming ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-error btn-xs gap-1"
              onClick={() => void remove()}
              disabled={busy}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              Confirm delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-xs text-error gap-1"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="alert alert-error text-sm mt-3">
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}

// --- Helpers ---

async function fetchRawColumns(sourceId: string): Promise<string[]> {
  const ds = getDataSource();
  const name = rawTableName(sourceId);
  try {
    const rows = await ds.query<{ column_name: string }>({
      sql:
        "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema = 'main' AND table_name = ? " +
        "ORDER BY ordinal_position",
      params: [name],
    });
    return rows.map((r) => r.column_name);
  } catch {
    return [];
  }
}

// Memoize column list extraction (used by mapping editor inside
// DerivationCard via props).
export function useMemoColumns(cols: string[]): string[] {
  return useMemo(() => cols, [cols.join("|")]);
}
