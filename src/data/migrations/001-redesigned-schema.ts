import type { DataSource } from "../types";
import type { Migration } from "./types";

// Web-first redesign of the config schema (plan
// 2026-05-11-config-redesign-web-first.md). Three architectural layers:
//   1. raw           main.raw_<source_id>
//   2. mapping       config.derivation_mappings + per-derivation tables
//   3. transform     config.derivation_transforms
//
// Two main entities: Source (config.sources) and Trait (config.traits).
// Derivations are the routing unit. Studies are a SQL view over sources
// with role=loci_definition (no separate table).
//
// DuckDB-WASM-specific:
//   - No ON DELETE CASCADE on FKs (DuckDB doesn't support cascading
//     actions). Children deleted manually in *Ops removal functions.
//   - Each statement runs as its own exec() call.

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
     synonyms              JSON,
     hierarchy_path        JSON,
     ot_phenotypes         JSON,
     ot_drugs              JSON,
     ot_therapeutic_areas  JSON,
     last_enriched_at      TIMESTAMP,
     row_version           INTEGER NOT NULL DEFAULT 1,
     created_at            TIMESTAMP NOT NULL DEFAULT now(),
     updated_at            TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_traits_primary_ont_id
     ON config.traits(primary_ontology, primary_ontology_id)`,

  `CREATE INDEX IF NOT EXISTS idx_traits_kind
     ON config.traits(trait_kind)`,

  // -- sources ---------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.sources (
     id            UUID PRIMARY KEY DEFAULT uuid(),
     name          VARCHAR NOT NULL UNIQUE,
     display_name  VARCHAR,
     description   VARCHAR,
     source_type   VARCHAR NOT NULL,
     url           VARCHAR,
     sheet         VARCHAR,
     skip_rows     INTEGER DEFAULT 0,
     row_version   INTEGER NOT NULL DEFAULT 1,
     created_at    TIMESTAMP NOT NULL DEFAULT now(),
     updated_at    TIMESTAMP NOT NULL DEFAULT now()
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
  // derivation instead. Drives the source-stack trait chips before any
  // build has happened.
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

  // -- derivations -----------------------------------------------------
  // The routing unit: one (raw source) → one (canonical evidence stream
  // tagged with category, role, trait scope). Most sources have one
  // derivation; multi-derivation sources share their raw table.
  `CREATE TABLE IF NOT EXISTS config.derivations (
     id                  UUID PRIMARY KEY DEFAULT uuid(),
     source_id           UUID NOT NULL REFERENCES config.sources(id),
     display_name        VARCHAR,
     role                VARCHAR NOT NULL,
     evidence_category   VARCHAR NOT NULL,
     centric             VARCHAR NOT NULL,
     trait_scope         VARCHAR NOT NULL,
     source_tag          VARCHAR NOT NULL UNIQUE,
     row_version         INTEGER NOT NULL DEFAULT 1,
     created_at          TIMESTAMP NOT NULL DEFAULT now(),
     updated_at          TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_derivations_source
     ON config.derivations(source_id)`,

  `CREATE INDEX IF NOT EXISTS idx_derivations_role
     ON config.derivations(role)`,

  // Column aliasing: canonical PEGASUS field → raw column name. Always
  // required; at minimum every derivation needs a gene_symbol mapping.
  `CREATE TABLE IF NOT EXISTS config.derivation_mappings (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     derivation_id   UUID NOT NULL REFERENCES config.derivations(id),
     canonical_field VARCHAR NOT NULL,
     raw_column      VARCHAR NOT NULL,
     UNIQUE (derivation_id, canonical_field)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_derivation_mappings_derivation
     ON config.derivation_mappings(derivation_id)`,

  // Transform recipe, scoped to one derivation. Same DSL as before (14
  // transform types, compiled to SQL by transform/compile.ts).
  `CREATE TABLE IF NOT EXISTS config.derivation_transforms (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     derivation_id   UUID NOT NULL REFERENCES config.derivations(id),
     seq             INTEGER NOT NULL,
     type            VARCHAR NOT NULL,
     params          JSON NOT NULL DEFAULT '{}',
     created_at      TIMESTAMP NOT NULL DEFAULT now(),
     UNIQUE (derivation_id, seq)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_derivation_transforms_derivation
     ON config.derivation_transforms(derivation_id)`,

  // For derivations with trait_scope = 'constant': the trait(s) every
  // emitted row carries.
  `CREATE TABLE IF NOT EXISTS config.derivation_traits (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     derivation_id   UUID NOT NULL REFERENCES config.derivations(id),
     trait_id        UUID NOT NULL REFERENCES config.traits(id),
     UNIQUE (derivation_id, trait_id)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_derivation_traits_derivation
     ON config.derivation_traits(derivation_id)`,

  // For derivations with trait_scope = 'column': the raw column to read
  // each row's trait from (optionally with a parallel column carrying
  // canonical trait IDs, e.g. EFO IDs).
  `CREATE TABLE IF NOT EXISTS config.derivation_trait_column (
     derivation_id   UUID PRIMARY KEY REFERENCES config.derivations(id),
     raw_column      VARCHAR NOT NULL,
     trait_id_lookup VARCHAR
   )`,

  // -- pegasus_settings (singleton) -----------------------------------
  `CREATE TABLE IF NOT EXISTS config.pegasus_settings (
     id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     window_kb                INTEGER NOT NULL DEFAULT 500,
     merge_distance_kb        INTEGER NOT NULL DEFAULT 100,
     locus_definition_source  VARCHAR,
     row_version              INTEGER NOT NULL DEFAULT 1,
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

  // -- audit_log ------------------------------------------------------
  // Generic outbox for any config table change. Kept from the prior
  // schema — the *Ops functions will write here on every mutation.
  `CREATE TABLE IF NOT EXISTS config.audit_log (
     id          UUID PRIMARY KEY DEFAULT uuid(),
     ts          TIMESTAMP NOT NULL DEFAULT now(),
     actor_id    UUID,
     entity_type VARCHAR NOT NULL,
     entity_id   UUID NOT NULL,
     op          VARCHAR NOT NULL,
     before_json JSON,
     after_json  JSON
   )`,

  `CREATE INDEX IF NOT EXISTS idx_audit_log_entity
     ON config.audit_log(entity_type, entity_id, ts)`,
];

const apply = async (ds: DataSource): Promise<void> => {
  for (const stmt of STATEMENTS) {
    await ds.exec({ sql: stmt });
  }
};

export const migration: Migration = {
  version: 1,
  name: "redesigned_schema",
  apply,
};
