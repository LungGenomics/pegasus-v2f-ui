import {
  Database,
  FileSpreadsheet,
  FlaskConical,
  Settings2,
} from "lucide-react";
import type { SourceStackItem, StudyStackItem } from "../../api/types";

type Selection =
  | { type: "source"; name: string }
  | { type: "study"; idPrefix: string }
  | null;

interface Props {
  sources: SourceStackItem[];
  studies: StudyStackItem[];
  selected: Selection;
  onSelectSource: (name: string) => void;
  onSelectStudy: (idPrefix: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  COLOC: "border-blue-400",
  MR: "border-emerald-400",
  FUNC: "border-purple-400",
  PHEWAS: "border-amber-400",
  RARE: "border-rose-400",
  OMIM: "border-teal-400",
};

const CATEGORY_COLORS_ACTIVE: Record<string, string> = {
  COLOC: "border-blue-500 bg-blue-500/5",
  MR: "border-emerald-500 bg-emerald-500/5",
  FUNC: "border-purple-500 bg-purple-500/5",
  PHEWAS: "border-amber-500 bg-amber-500/5",
  RARE: "border-rose-500 bg-rose-500/5",
  OMIM: "border-teal-500 bg-teal-500/5",
};

function categoryBorder(category: string, active: boolean): string {
  if (active) return CATEGORY_COLORS_ACTIVE[category] ?? "border-base-content/30 bg-base-200";
  return CATEGORY_COLORS[category] ?? "border-base-300";
}

export function SourceStack({
  sources,
  studies,
  selected,
  onSelectSource,
  onSelectStudy,
}: Props) {
  return (
    <div className="space-y-5">
      {/* Studies section */}
      {studies.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-base-content/40 mb-1.5 flex items-center gap-1.5 px-1">
            <FlaskConical className="size-3" />
            Studies
          </h3>
          <div className="space-y-1">
            {studies.map((study) => {
              const isSelected =
                selected?.type === "study" &&
                selected.idPrefix === study.idPrefix;
              return (
                <button
                  key={study.idPrefix}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors border-l-3 ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-base-200/60"
                  }`}
                  onClick={() => onSelectStudy(study.idPrefix)}
                >
                  <div className="font-medium text-sm">{study.idPrefix}</div>
                  <div className="text-xs text-base-content/50 mt-0.5 truncate">
                    {study.traits.join(", ")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sources section */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-base-content/40 mb-1.5 flex items-center gap-1.5 px-1">
          <Database className="size-3" />
          Sources
          <span className="text-base-content/30">{sources.length}</span>
        </h3>
        <div className="space-y-1">
          {sources.map((source) => {
            const isSelected =
              selected?.type === "source" && selected.name === source.name;
            return (
              <button
                key={source.name}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors border-l-3 ${
                  categoryBorder(source.category, isSelected)
                } ${!isSelected ? "hover:bg-base-200/60" : ""}`}
                onClick={() => onSelectSource(source.name)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">
                    {source.displayName}
                  </span>
                  <span className="text-[10px] font-medium text-base-content/40 shrink-0">
                    {source.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-base-content/40">
                  <span className="flex items-center gap-1">
                    <SourceTypeIcon type={source.sourceType} />
                    {source.sourceType}
                  </span>
                  {source.transformCount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Settings2 className="size-3" />
                      {source.transformCount}
                    </span>
                  )}
                  <span
                    className={`ml-auto text-[10px] ${
                      source.status === "built"
                        ? "text-success"
                        : "text-base-content/30"
                    }`}
                  >
                    {source.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourceTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "googlesheets":
    case "excel":
      return <FileSpreadsheet className="size-3" />;
    default:
      return <Database className="size-3" />;
  }
}
