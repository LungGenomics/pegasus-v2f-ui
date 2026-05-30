---
date: 2026-05-30
status: complete
description: Admin-gated inline editor for trait ontology mapping + kind on the Traits page
---

# Trait metadata editor (admin)

## Problem

Traits are born from sources: constant-scope mappings assign them via the OLS
picker (resolved + enriched), but **column-scope** mappings auto-create them as
**bare labels** (`ensureColumnScopeTraits` → `findOrCreateByLabel`) that never
touch OLS. So column-derived traits (FEV1, FVC, COPD…) have no description and
no ontology mapping, and there is **no surface to curate them** — the Traits
page is read-only.

## Decision (settled with Sam)

A **pencil icon, top-right of the trait content section**, shown only to
signed-in users (admins). It opens an editor for a single trait.

Field rules:
- **Label** — read-only. It is assigned from the source and is the data join
  key for column-scope re-derivation; renaming would orphan/duplicate it.
- **Description** — read-only, strictly ontology-sourced. The admin changes it
  only *indirectly* by changing the ontology mapping (or clearing it → no
  description). No free-text description, no `user_notes` column.
- **Ontology mapping** — editable via an OLS picker. Pick a term → set
  `primary_ontology` / `primary_ontology_id` / `ontology_label` and run
  enrichment (fills description, synonyms, xrefs, hierarchy, kind). Or **Clear**
  → wipe back to a bare unmapped label.
- **`trait_kind`** — overridable dropdown: `auto (inferred) | measurement |
  disease | phenotype | other`. An explicit override must survive a later
  "Refresh enrichment" (which otherwise re-infers kind from the ontology
  ancestors).
- **Enrichment block** (synonyms / xrefs / hierarchy / OT / `last_enriched_at`)
  — read-only display, with a **Refresh enrichment** button.

Consequence accepted: a genuinely-unmappable trait (FEV1/FVC ratio z-score,
%-predicted) that can't be mapped has **no description, ever**. Consistent with
the plan's "unmapped is a valid state."

## Implementation

### 1. Schema — migration 005 (additive ALTER, no nuke)

`ALTER TABLE config.traits ADD COLUMN IF NOT EXISTS trait_kind_overridden
BOOLEAN NOT NULL DEFAULT FALSE`. Lets enrichment know not to clobber a
hand-set kind. Additive so existing local DBs keep their traits.

### 2. Write path — `src/data/traitMetadata.ts` (new)

All admin-gated (actor = session login), audit-stamped, dirty by virtue of
writing `config.traits`.

- `setTraitMapping(traitId, ols: OlsSearchResult, actor)` — look up the trait by
  **id** (keep its existing label), `upsertTrait({ label: trait.label,
  primary_ontology, primary_ontology_id, ontology_label: ols.label,
  description: ols.description, synonyms: ols.synonyms }, actor)`, then
  `enrichTrait(traitId)` to fill the rest. (Note: `ontology_label` = the OLS
  term name; `label` stays the source-assigned trait label.)
- `clearTraitMapping(traitId, actor)` — dedicated UPDATE that **nulls**
  ontology + description + every enrichment column + `last_enriched_at`, resets
  `trait_kind` to null and `trait_kind_overridden` to false, bumps
  `row_version`, sets `last_edited_by`. (Can't use `upsertTrait` — it coalesces
  and never nulls.)
- `setTraitKind(traitId, kind | 'auto', actor)` —
  - specific kind → set `trait_kind = kind`, `trait_kind_overridden = true`.
  - `'auto'` → set `trait_kind_overridden = false`, then if mapped re-run
    `enrichTrait` to re-infer, else set `trait_kind = null`.

### 3. enrich.ts — honor the override

In `runStage1`, read `trait.trait_kind_overridden`; when true, pass
`trait_kind: trait.trait_kind` (preserve) instead of `inferTraitKind(ancestors)`.
Add `trait_kind_overridden` to `ConfigTrait` + the `getTrait`/`listTraits`
selects so it round-trips.

### 4. UI — `src/pages/explore/trait-detail.tsx` + new editor

- Pencil button in the content header (`trait-detail.tsx` ~line 236), rendered
  only when `useSyncSession()` returns a login.
- New `TraitEditor` (modal or right-side panel):
  - Label (read-only), current mapping display.
  - OLS search box (reuse the search list pattern from `trait-input`) → on pick,
    `setTraitMapping`. **Clear mapping** button → `clearTraitMapping`.
  - `trait_kind` dropdown → `setTraitKind`.
  - Read-only enrichment block + **Refresh enrichment** (`enrichTrait`).
  - Invalidate `["explore","trait",id]` + `["traits"]` on every write.

## Risks / notes

- OLS resolution for abbreviations is the hard part, but it's now a **manual**
  pick in this editor, so accuracy is the admin's call (no auto-guessing).
- `setTraitMapping` must key the upsert on the existing label, not the OLS term
  label, or it would fork a new trait row.
- Verify OLS/OXO/OT calls actually succeed from the browser (CORS) when wiring
  Refresh — they degrade silently today.

## Out of scope (v1)

Batch "resolve all unmapped" / "refresh all", parent-trait grouping, custom
user synonyms, label editing.

## Implementation log (2026-05-30)

Per Sam's call, **no new migration** — the schema is recreated from scratch in
dev. Consolidated the migration history into a single base schema instead:

- **`migrations/001-redesigned-schema.ts`** — folded in the former 002 (publish
  tracker: `sources.raw_version`, `config._publish_state`, `config._publish_meta`)
  and added `config.traits.trait_kind_overridden BOOLEAN NOT NULL DEFAULT FALSE`.
  003 (audit columns) and 004 (derived-layer settings) were already present in
  001, so they were pure back-compat shims.
- **Deleted** `002-publish-tracker.ts`, `003-audit-columns.ts`,
  `004-derived-layer-settings.ts`; `migrations/index.ts` now lists only `m001`.
- **`api/types.ts`** + **`traitOps.ts`** — threaded `trait_kind_overridden`
  through `ConfigTrait`, the row type/mapper, `TRAIT_COLS`, `UpsertTraitInput`,
  and both upsert branches.
- **`ontology/enrich.ts`** — `runStage1` preserves a hand-set kind when
  `trait_kind_overridden`, else re-infers.
- **`data/traitMetadata.ts`** (new) — `setTraitMapping` (explicit UPDATE that
  resets stale enrichment, then `enrichTrait`), `clearTraitMapping`,
  `setTraitKind` (override vs auto). Direct UPDATEs because `upsertTrait`
  coalesces and can't NULL.
- **`components/trait-editor/trait-editor.tsx`** (new) — modal: read-only label,
  OLS search→map / Clear, kind dropdown, read-only enrichment block + Refresh.
- **`pages/explore/trait-detail.tsx`** — pencil top-right of the header, shown
  only when `useSyncSession()` has a login; opens the editor.

Typecheck + `vite build` both green.

**Manual verification still needed** (requires a fresh DB): recreate the DB,
open a column-scope trait (e.g. FEV1), confirm the pencil appears when signed
in, map it to an OLS term, and confirm the description/ontology populate and the
kind override survives a Refresh. Also confirm OLS/OXO/OT calls succeed from the
browser (they degrade silently).
