import type { DataSource } from "../types";
import type { Migration } from "./types";

// Web-first redesign of the config schema. Three architectural layers:
//   1. raw         main.raw_<source_id>
//   2. transform   config.source_transforms (clean the raw, source-level)
//   3. mapping     config.mappings + mapping_fields/traits/trait_column
//
// Two main entities: Source (config.sources) and Trait (config.traits).
// A mapping is the projection unit (target = 'evidence' | 'loci'); transforms
// clean the raw ONCE and are shared by all of a source's mappings. Studies are
// a SQL view over sources that have a loci mapping (no separate table).
//
// DuckDB-WASM-specific:
//   - No ON DELETE CASCADE on FKs (DuckDB doesn't support cascading
//     actions). Children deleted manually in *Ops removal functions.
//   - Each statement runs as its own exec() call.
//
// This is the single base schema: the former incremental migrations 002
// (publish tracker), 003 (audit columns), 004 (derived-layer settings) and
// the trait_kind_overridden flag are all folded in here. The DB is recreated
// from scratch in dev, so no incremental migration history is kept.

const STATEMENTS: string[] = [
  `CREATE SCHEMA IF NOT EXISTS config`,

  `CREATE TABLE IF NOT EXISTS main._migrations (
     version    INTEGER PRIMARY KEY,
     name       VARCHAR NOT NULL,
     applied_at TIMESTAMP NOT NULL DEFAULT now(),
     checksum   VARCHAR
   )`,

  // -- traits ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.traits (
     id                    UUID PRIMARY KEY DEFAULT uuid(),
     label                 VARCHAR NOT NULL UNIQUE,
     description           VARCHAR,
     primary_ontology      VARCHAR,
     primary_ontology_id   VARCHAR,
     ontology_label        VARCHAR,
     xrefs                 JSON,
     ontology_version      VARCHAR,
     parent_trait_id       UUID REFERENCES config.traits(id),
     trait_kind            VARCHAR,
     trait_kind_overridden BOOLEAN NOT NULL DEFAULT FALSE,
     synonyms              JSON,
     hierarchy_path        JSON,
     ot_phenotypes         JSON,
     ot_drugs              JSON,
     ot_therapeutic_areas  JSON,
     last_enriched_at      TIMESTAMP,
     row_version           INTEGER NOT NULL DEFAULT 1,
     created_by            VARCHAR,
     last_edited_by        VARCHAR,
     created_at            TIMESTAMP NOT NULL DEFAULT now(),
     updated_at            TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_traits_primary_ont_id
     ON config.traits(primary_ontology, primary_ontology_id)`,

  `CREATE INDEX IF NOT EXISTS idx_traits_kind
     ON config.traits(trait_kind)`,

  // -- sources ---------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.sources (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     name            VARCHAR NOT NULL UNIQUE,
     display_name    VARCHAR,
     description     VARCHAR,
     source_type     VARCHAR NOT NULL,
     url             VARCHAR,
     sheet           VARCHAR,
     skip_rows       INTEGER DEFAULT 0,
     row_version     INTEGER NOT NULL DEFAULT 1,
     raw_version     INTEGER DEFAULT 0,
     created_by      VARCHAR,
     last_edited_by  VARCHAR,
     created_at      TIMESTAMP NOT NULL DEFAULT now(),
     updated_at      TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sources_name
     ON config.sources(name)`,

  // Optional citation metadata for sources that represent a published
  // study (loci-definition role typically). 1:1 with config.sources.
  `CREATE TABLE IF NOT EXISTS config.source_citation (
     source_id     UUID PRIMARY KEY REFERENCES config.sources(id),
     gwas_source   VARCHAR,
     ancestry      VARCHAR,
     sample_size   BIGINT,
     doi           VARCHAR,
     year          INTEGER,
     pubmed_id     VARCHAR,
     updated_at    TIMESTAMP NOT NULL DEFAULT now()
   )`,

  // Declared (source, trait) associations. Optional; for sources whose
  // trait is a per-row column we store the column reference on the
  // mapping instead. Drives the source trait chips before any build.
  `CREATE TABLE IF NOT EXISTS config.source_traits (
     id          UUID PRIMARY KEY DEFAULT uuid(),
     source_id   UUID NOT NULL REFERENCES config.sources(id),
     trait_id    UUID NOT NULL REFERENCES config.traits(id),
     UNIQUE (source_id, trait_id)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_source_traits_source
     ON config.source_traits(source_id)`,

  `CREATE INDEX IF NOT EXISTS idx_source_traits_trait
     ON config.source_traits(trait_id)`,

  // -- source transforms ----------------------------------------------
  // Transform DSL steps that CLEAN the raw table, applied once and shared
  // by every mapping of the source (same DSL, 14 types, compiled to SQL by
  // transform/compile.ts).
  `CREATE TABLE IF NOT EXISTS config.source_transforms (
     id           UUID PRIMARY KEY DEFAULT uuid(),
     source_id    UUID NOT NULL REFERENCES config.sources(id),
     seq          INTEGER NOT NULL,
     type         VARCHAR NOT NULL,
     params       JSON NOT NULL DEFAULT '{}',
     created_at   TIMESTAMP NOT NULL DEFAULT now(),
     UNIQUE (source_id, seq)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_source_transforms_source
     ON config.source_transforms(source_id)`,

  // -- mappings --------------------------------------------------------
  // The projection unit (replaces derivations): one (cleaned source) → one
  // output stream. target='evidence' emits canonical evidence rows (with a
  // category + trait); target='loci' builds loci (with window/merge, which
  // are per-mapping so different sources can resolve loci differently).
  // Most sources have one mapping; multi-mapping sources share their raw
  // table + transforms.
  `CREATE TABLE IF NOT EXISTS config.mappings (
     id                  UUID PRIMARY KEY DEFAULT uuid(),
     source_id           UUID NOT NULL REFERENCES config.sources(id),
     display_name        VARCHAR,
     target              VARCHAR NOT NULL,
     evidence_category   VARCHAR,
     -- Source column whose (already-prepared) value IS each evidence row's
     -- score for this category — a plain column alias, NO calculation here.
     -- Any derivation (e.g. -log10(p)) belongs in the transform pipeline.
     -- Required for target='evidence'; NULL for target='loci'.
     score_column        VARCHAR,
     centric             VARCHAR,
     trait_scope         VARCHAR,
     source_tag          VARCHAR NOT NULL UNIQUE,
     window_kb           INTEGER,
     merge_distance_kb   INTEGER,
     row_version         INTEGER NOT NULL DEFAULT 1,
     created_by          VARCHAR,
     last_edited_by      VARCHAR,
     created_at          TIMESTAMP NOT NULL DEFAULT now(),
     updated_at          TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_mappings_source
     ON config.mappings(source_id)`,

  `CREATE INDEX IF NOT EXISTS idx_mappings_target
     ON config.mappings(target)`,

  // Column aliasing: canonical PEGASUS field → raw column name. Always
  // required; at minimum every mapping needs a gene_symbol field.
  `CREATE TABLE IF NOT EXISTS config.mapping_fields (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     mapping_id      UUID NOT NULL REFERENCES config.mappings(id),
     canonical_field VARCHAR NOT NULL,
     raw_column      VARCHAR NOT NULL,
     UNIQUE (mapping_id, canonical_field)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_mapping_fields_mapping
     ON config.mapping_fields(mapping_id)`,

  // For mappings with trait_scope = 'constant': the trait(s) every emitted
  // row carries.
  `CREATE TABLE IF NOT EXISTS config.mapping_traits (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     mapping_id      UUID NOT NULL REFERENCES config.mappings(id),
     trait_id        UUID NOT NULL REFERENCES config.traits(id),
     UNIQUE (mapping_id, trait_id)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_mapping_traits_mapping
     ON config.mapping_traits(mapping_id)`,

  // For mappings with trait_scope = 'column': the raw column to read each
  // row's trait from (optionally with a parallel column carrying canonical
  // trait IDs, e.g. EFO IDs).
  `CREATE TABLE IF NOT EXISTS config.mapping_trait_column (
     mapping_id      UUID PRIMARY KEY REFERENCES config.mappings(id),
     raw_column      VARCHAR NOT NULL,
     trait_id_lookup VARCHAR
   )`,

  // -- pegasus_settings (singleton) -----------------------------------
  `CREATE TABLE IF NOT EXISTS config.pegasus_settings (
     id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     window_kb                INTEGER NOT NULL DEFAULT 500,
     merge_distance_kb        INTEGER NOT NULL DEFAULT 100,
     locus_definition_source  VARCHAR,
     gene_reference_url       VARCHAR,
     candidate_gene_biotypes  VARCHAR DEFAULT 'protein_coding,lncRNA',
     row_version              INTEGER NOT NULL DEFAULT 1,
     -- Who last changed settings (NULL on the seeded row) — drives the
     -- Activity feed entry, same as the entity tables' last_edited_by.
     last_edited_by           VARCHAR,
     updated_at               TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `INSERT INTO config.pegasus_settings (id) VALUES (1) ON CONFLICT DO NOTHING`,

  // -- config_meta (singleton) ----------------------------------------
  `CREATE TABLE IF NOT EXISTS config.config_meta (
     id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     schema_version      INTEGER NOT NULL,
     last_imported_at    TIMESTAMP
   )`,

  `INSERT INTO config.config_meta (id, schema_version) VALUES (1, 1)
     ON CONFLICT DO NOTHING`,

  // (No event-log table. Provenance is derived from the created_by /
  //  last_edited_by / *_at columns on the config entities — see the Activity
  //  feed in queries/activity.ts. The former config.audit_log table was never
  //  wired and has been removed.)

  // -- publish tracker (local dirty-state for the explicit-Publish model,
  // plan 2026-05-19). config.sources.raw_version (above) bumps on each
  // (re)ingest; _publish_state snapshots each source's content signature at
  // the last Publish; _publish_meta holds the last published R2 version key.
  `CREATE TABLE IF NOT EXISTS config._publish_state (
     source_id    UUID PRIMARY KEY,
     sig          VARCHAR NOT NULL,
     published_at TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS config._publish_meta (
     id           INTEGER PRIMARY KEY DEFAULT 1,
     version_key  VARCHAR,
     published_at TIMESTAMP
   )`,
];

const apply = async (ds: DataSource): Promise<void> => {
  for (let i = 0; i < STATEMENTS.length; i++) {
    const stmt = STATEMENTS[i]!;
    // First word of the statement for a compact label.
    const label = stmt.trim().split(/\s+/).slice(0, 6).join(" ");
    try {
      await ds.exec({ sql: stmt });
    } catch (err) {
      console.error(
        `[migration 001] statement ${i + 1}/${STATEMENTS.length} failed: ${label}…`,
        err,
      );
      throw err;
    }
  }
};

export const migration: Migration = {
  version: 1,
  name: "redesigned_schema",
  apply,
};
