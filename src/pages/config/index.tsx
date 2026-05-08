import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { useConfig } from "../../api/config";
import { useSources } from "../../api/sources";
import { Loading, ErrorAlert } from "../../components/loading";
import { SourceStack } from "./source-stack";
import { SourceDetail } from "./source-detail";
import { StudyDetail } from "./study-detail";
import { ConfigDraftProvider } from "./config-draft-context";
import { NewSourceForm } from "./new-source-form";
import type {
  V2fSourceConfig,
  V2fStudyConfig,
  SourceStackItem,
  StudyStackItem,
  Source,
} from "../../api/types";

type Selection =
  | { type: "source"; name: string }
  | { type: "study"; idPrefix: string }
  | { type: "new-source" }
  | null;

export function ConfigWorkspace() {
  const [params, setParams] = useSearchParams();
  const { data: config, isLoading: configLoading, error: configError } = useConfig();
  const { data: dbSources, isLoading: dbLoading } = useSources();
  const [selected, setSelected] = useState<Selection>(null);

  // Select source from URL param on mount (e.g., /sources?source=lung_deg)
  useEffect(() => {
    const sourceParam = params.get("source");
    if (sourceParam && !selected) {
      setSelected({ type: "source", name: sourceParam });
      setParams({}, { replace: true });
    }
  }, [params, selected, setParams]);

  const dbSourceMap = useMemo(() => {
    const map = new Map<string, Source>();
    for (const s of dbSources ?? []) {
      map.set(s.name, s);
    }
    return map;
  }, [dbSources]);

  const sourceItems = useMemo((): SourceStackItem[] => {
    const sources = config?.data_sources ?? [];
    return sources.map((s: V2fSourceConfig) => {
      const db = dbSourceMap.get(s.name);
      const evidence = Array.isArray(s.evidence) ? s.evidence : s.evidence ? [s.evidence] : [];
      return {
        name: s.name,
        displayName: s.display_name ?? s.name,
        category: evidence[0]?.category ?? "",
        sourceType: s.source_type,
        transformCount: s.transformations?.length ?? 0,
        evidenceCount: evidence.length,
        status: db ? "built" : "configured",
        dbRowCount: undefined, // could enrich from a row-count endpoint later
      };
    });
  }, [config, dbSourceMap]);

  const studyItems = useMemo((): StudyStackItem[] => {
    const studies = config?.pegasus?.study ?? [];
    return studies.map((s: V2fStudyConfig) => ({
      idPrefix: s.id_prefix,
      traits: s.traits ?? [],
      gwasSource: s.gwas_source,
      ancestry: s.ancestry,
      status: "configured" as const, // TODO: enrich with DB study lookup
    }));
  }, [config]);

  const selectedSource = useMemo(() => {
    if (selected?.type !== "source") return undefined;
    return (config?.data_sources ?? []).find(
      (s: V2fSourceConfig) => s.name === selected.name,
    );
  }, [config, selected]);

  const selectedStudy = useMemo(() => {
    if (selected?.type !== "study") return undefined;
    return (config?.pegasus?.study ?? []).find(
      (s: V2fStudyConfig) => s.id_prefix === selected.idPrefix,
    );
  }, [config, selected]);

  if (configLoading || dbLoading) return <Loading />;
  if (configError) return <ErrorAlert message={configError.message} />;

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-semibold">Sources</h1>
        <span className="text-sm text-base-content/40">
          {sourceItems.length} sources · {studyItems.length} studies
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setSelected({ type: "new-source" })}
          className="btn btn-sm btn-primary gap-1"
        >
          <Plus className="size-3.5" />
          New source
        </button>
      </div>

      <div className="flex gap-6 h-[calc(100vh-8rem)]">
        {/* Left pane: stack */}
        <div className="w-64 shrink-0 overflow-y-auto">
          <SourceStack
            sources={sourceItems}
            studies={studyItems}
            selected={selected}
            onSelectSource={(name) => setSelected({ type: "source", name })}
            onSelectStudy={(idPrefix) =>
              setSelected({ type: "study", idPrefix })
            }
          />
        </div>

        {/* Right pane: detail */}
        <div className="flex-1 overflow-y-auto">
          {selected?.type === "new-source" ? (
            <NewSourceForm
              onCreated={(name) => setSelected({ type: "source", name })}
              onCancel={() => setSelected(null)}
            />
          ) : selectedSource ? (
            <ConfigDraftProvider key={selectedSource.name}>
              <SourceDetail source={selectedSource} />
            </ConfigDraftProvider>
          ) : selectedStudy ? (
            <StudyDetail study={selectedStudy} />
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
              Select a source or study, or click "New source" to create one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
