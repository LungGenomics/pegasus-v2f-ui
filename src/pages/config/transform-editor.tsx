import { useState, useMemo } from "react";
import { type ColumnTable } from "arquero";
import { ArrowUp, ArrowDown, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { TransformConfigEntry } from "../../api/types";
import { TransformParamEditor } from "../../components/schema-form/transform-param-editor";

export interface StagePreview {
  rowCount: number;
  columnNames: string[];
  table: ColumnTable;
  error?: string;
}

interface Props {
  config: TransformConfigEntry;
  availableColumns: string[];
  preview?: StagePreview;
  onChange: (config: TransformConfigEntry) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function TransformEditor({
  config,
  availableColumns,
  preview,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: Props) {
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const previewRows = useMemo(() => {
    if (!previewExpanded || !preview) return [];
    try {
      return preview.table.slice(0, 10).objects() as Record<string, unknown>[];
    } catch {
      return [];
    }
  }, [previewExpanded, preview]);

  return (
    <div>
      {/* Header: type + row counts + controls */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <span className="font-medium text-sm flex-1">{config.type}</span>
        {preview && (
          <span className="text-xs text-base-content/35 tabular-nums">
            {preview.rowCount}r x {preview.columnNames.length}c
          </span>
        )}
        {preview?.error && <AlertTriangle className="size-3.5 text-error shrink-0" />}
        <div className="flex items-center gap-0.5">
          <button className="btn btn-ghost btn-xs" onClick={onMoveUp} disabled={isFirst} title="Move up">
            <ArrowUp className="size-3.5" />
          </button>
          <button className="btn btn-ghost btn-xs" onClick={onMoveDown} disabled={isLast} title="Move down">
            <ArrowDown className="size-3.5" />
          </button>
          <button className="btn btn-ghost btn-xs text-error/60 hover:text-error" onClick={onRemove} title="Remove">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {preview?.error && (
        <div className="px-3 pb-1 text-xs text-error">{preview.error}</div>
      )}

      {/* Fields */}
      <div className="px-3 pb-2.5 pt-1">
        <TransformFields config={config} columns={availableColumns} onChange={onChange} />
      </div>

      {/* Inline data preview */}
      {preview && (
        <div className="border-t border-black/5">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-black/[0.02] transition-colors text-xs text-base-content/40"
            onClick={() => setPreviewExpanded(!previewExpanded)}
          >
            {previewExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Preview
          </button>
          {previewExpanded && previewRows.length > 0 && (
            <div className="overflow-x-auto border-t border-black/5">
              <table className="table table-xs">
                <thead>
                  <tr className="text-base-content/40">
                    {preview.columnNames.map((col) => (
                      <th key={col} className="whitespace-nowrap font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {preview.columnNames.map((col) => (
                        <td key={col} className="max-w-48 truncate">
                          {row[col] == null ? (
                            <span className="text-base-content/20">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dynamic fields per transform type ---

function TransformFields({
  config,
  onChange,
}: {
  config: TransformConfigEntry;
  /** Available columns from the upstream stage's preview — kept in props for
   *  forward-compat with schema-form fields that opt into column-ref typing. */
  columns: string[];
  onChange: (c: TransformConfigEntry) => void;
}) {
  // Schema-driven: pull the right schema from data/config-schema/transforms
  // and render via SchemaFields. Adding a new transform type now means a
  // schema entry + a compiler entry, no field component edits.
  return <TransformParamEditor transform={config} onChange={onChange} />;
}

