// First-pass audit panel (Database page). A commit-history-style feed of
// recent config changes, derived from the created_by/last_edited_by/*_at
// columns (recentChanges). Read-only.

import { useQuery } from "@tanstack/react-query";
import { recentChanges, type ChangeEntry } from "../../data/queries/audit";

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AuditPanel() {
  const q = useQuery({ queryKey: ["audit-recent"], queryFn: () => recentChanges(100) });
  const entries = q.data ?? [];

  return (
    <div>
      <h2 className="text-sm font-medium text-base-content/60 mb-3">Activity</h2>
      {q.isLoading ? (
        <p className="text-xs text-base-content/40">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-base-content/40">
          No recorded changes yet. Edits made while signed in show up here.
        </p>
      ) : (
        <div className="border border-base-300 rounded-md divide-y divide-base-300 overflow-auto">
          {entries.map((e, i) => (
            <ChangeRow key={i} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRow({ entry }: { entry: ChangeEntry }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <span
        className={`badge badge-xs ${
          entry.op === "created" ? "badge-success" : "badge-ghost"
        }`}
      >
        {entry.op}
      </span>
      <span className="text-base-content/50">{entry.entity_type}</span>
      <span className="font-mono font-medium truncate">{entry.label}</span>
      <span className="ml-auto shrink-0 text-base-content/40 inline-flex items-center gap-2">
        {entry.actor ? (
          <span className="font-mono">@{entry.actor}</span>
        ) : (
          <span className="italic">unsigned</span>
        )}
        <span>{relTime(entry.ts)}</span>
      </span>
    </div>
  );
}
