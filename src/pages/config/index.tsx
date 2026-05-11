// PLACEHOLDER during the web-first config redesign
// (plan 2026-05-11-config-redesign-web-first.md).
//
// The legacy /config workspace (source stack + study/source detail
// editors built around evidence_blocks) is being replaced by a new
// add-data wizard + derivation-based source editor in Phase 3 and 4 of
// the redesign. Until those land, this route renders a notice so the
// app still loads.

import { Link } from "react-router";

export function ConfigWorkspace() {
  return (
    <div className="max-w-2xl py-12 space-y-4">
      <h1 className="text-lg font-semibold">Config workspace — under rebuild</h1>
      <p className="text-sm text-base-content/70">
        The config workspace is being rebuilt as part of the web-first
        config redesign. The new add-data wizard and source/derivation
        editor land in Phases 3 and 4 of the plan.
      </p>
      <p className="text-sm text-base-content/70">
        In the meantime, the read-side pages still work:{" "}
        <Link to="/" className="link link-primary">
          Traits
        </Link>
        {", "}
        <Link to="/genes" className="link link-primary">
          Genes
        </Link>
        {", "}
        <Link to="/sources" className="link link-primary">
          Sources
        </Link>
        {"."}
      </p>
      <p className="text-xs text-base-content/40">
        See plans/2026-05-11-config-redesign-web-first.md for the
        full restructure.
      </p>
    </div>
  );
}
