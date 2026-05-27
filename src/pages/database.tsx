// Database tab (redesign) — placeholder. Workspace plumbing: raw + derived
// tables, ad-hoc SQL console, and version history/restore. The "this is one
// DuckDB file" surface — the DB load/export controls live here now (moved out
// of the navbar).

import { DataSourcePicker } from "../components/data-source-picker";

export function DatabasePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold mb-1">Database</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Browse tables, run ad-hoc SQL, and manage version history.
      </p>

      <section className="border border-base-300 rounded-lg bg-base-100 p-4 mb-6">
        <h2 className="text-sm font-medium text-base-content/60 mb-3">
          Database file
        </h2>
        <DataSourcePicker />
      </section>

      <div className="border border-dashed border-base-300 rounded-lg p-10 text-center text-sm text-base-content/40">
        Placeholder — table browser, SQL console, and publish/history go here.
      </div>
    </div>
  );
}
