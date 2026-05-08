import type { DataSource } from "../types";
import type { Migration } from "./types";

// Statements run in order; each one is its own exec() call so DuckDB-WASM
// can parse them individually. DuckDB doesn't support multi-statement strings
// the way some Postgres drivers do.
const STATEMENTS: string[] = [
  `CREATE SCHEMA IF NOT EXISTS config`,

  `CREATE TABLE IF NOT EXISTS main._migrations (
     version    INTEGER PRIMARY KEY,
     name       VARCHAR NOT NULL,
     applied_at TIMESTAMP NOT NULL DEFAULT now(),
     checksum   VARCHAR
   )`,

  // -- source_configs ----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.source_configs (
     id                UUID PRIMARY KEY DEFAULT uuid(),
     name              VARCHAR NOT NULL,
     source_type       VARCHAR NOT NULL,
     url               VARCHAR,
     sheet             VARCHAR,
     skip_rows         INTEGER DEFAULT 0,
     display_name      VARCHAR,
     description       VARCHAR,
     data_type         VARCHAR,
     gene_column       VARCHAR,
     include_in_search BOOLEAN DEFAULT TRUE,
     row_version       INTEGER NOT NULL DEFAULT 1,
     created_at        TIMESTAMP NOT NULL DEFAULT now(),
     updated_at        TIMESTAMP NOT NULL DEFAULT now(),
     created_by        UUID,
     updated_by        UUID
   )`,

  `CREATE INDEX IF NOT EXISTS idx_source_configs_name
     ON config.source_configs(name)`,

  `CREATE TABLE IF NOT EXISTS config.source_transformations (
     id           UUID PRIMARY KEY DEFAULT uuid(),
     source_id    UUID NOT NULL REFERENCES config.source_configs(id),
     seq          INTEGER NOT NULL,
     type         VARCHAR NOT NULL,
     params       JSON NOT NULL DEFAULT '{}',
     created_at   TIMESTAMP NOT NULL DEFAULT now(),
     updated_at   TIMESTAMP NOT NULL DEFAULT now(),
     UNIQUE (source_id, seq)
   )`,

  `CREATE TABLE IF NOT EXISTS config.source_evidence_blocks (
     id                UUID PRIMARY KEY DEFAULT uuid(),
     source_id         UUID NOT NULL REFERENCES config.source_configs(id),
     source_tag        VARCHAR NOT NULL UNIQUE,
     evidence_category VARCHAR NOT NULL,
     role              VARCHAR,
     centric           VARCHAR,
     fields            JSON NOT NULL DEFAULT '{}',
     created_at        TIMESTAMP NOT NULL DEFAULT now(),
     updated_at        TIMESTAMP NOT NULL DEFAULT now()
   )`,

  // -- study_configs -----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.study_configs (
     id              UUID PRIMARY KEY DEFAULT uuid(),
     id_prefix       VARCHAR NOT NULL,
     display_name    VARCHAR,
     description     VARCHAR,
     gwas_source     VARCHAR,
     ancestry        VARCHAR,
     sample_size     BIGINT,
     doi             VARCHAR,
     year            INTEGER,
     loci_source     VARCHAR,
     loci_sheet      VARCHAR,
     loci_skip       INTEGER DEFAULT 0,
     gene_column     VARCHAR,
     sentinel_column VARCHAR,
     pvalue_column   VARCHAR,
     rsid_column     VARCHAR,
     row_version     INTEGER NOT NULL DEFAULT 1,
     created_at      TIMESTAMP NOT NULL DEFAULT now(),
     updated_at      TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_study_configs_prefix
     ON config.study_configs(id_prefix)`,

  `CREATE TABLE IF NOT EXISTS config.study_traits (
     id                UUID PRIMARY KEY DEFAULT uuid(),
     study_id          UUID NOT NULL REFERENCES config.study_configs(id),
     trait             VARCHAR NOT NULL,
     trait_description VARCHAR,
     trait_ontology_id VARCHAR,
     UNIQUE (study_id, trait)
   )`,

  `CREATE TABLE IF NOT EXISTS config.study_transformations (
     id         UUID PRIMARY KEY DEFAULT uuid(),
     study_id   UUID NOT NULL REFERENCES config.study_configs(id),
     seq        INTEGER NOT NULL,
     type       VARCHAR NOT NULL,
     params     JSON NOT NULL DEFAULT '{}',
     created_at TIMESTAMP NOT NULL DEFAULT now(),
     updated_at TIMESTAMP NOT NULL DEFAULT now(),
     UNIQUE (study_id, seq)
   )`,

  // -- pegasus_settings (singleton) -------------------------------------
  `CREATE TABLE IF NOT EXISTS config.pegasus_settings (
     id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     window_kb                INTEGER NOT NULL DEFAULT 500,
     merge_distance_kb        INTEGER NOT NULL DEFAULT 100,
     locus_definition_source  VARCHAR,
     row_version              INTEGER NOT NULL DEFAULT 1,
     updated_at               TIMESTAMP NOT NULL DEFAULT now()
   )`,

  `INSERT INTO config.pegasus_settings (id) VALUES (1) ON CONFLICT DO NOTHING`,

  // -- config_meta (singleton) ------------------------------------------
  `CREATE TABLE IF NOT EXISTS config.config_meta (
     id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     schema_version      INTEGER NOT NULL,
     exported_from_yaml  VARCHAR,
     last_imported_at    TIMESTAMP
   )`,

  `INSERT INTO config.config_meta (id, schema_version) VALUES (1, 1)
     ON CONFLICT DO NOTHING`,

  // -- audit_log --------------------------------------------------------
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
  name: "initial_config_schema",
  apply,
};
