# pegasus-v2f-ui

Browser-only web interface for exploring pegasus.v2f databases. Runs entirely
in the browser via [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview).
**No server required.** Open a `.duckdb` file and start exploring.

The file lives in the browser's [Origin Private File System](https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system),
so it persists across reloads and tabs without ever leaving your machine.

## Development

```bash
npm install
npm run dev
```

Open the URL Vite prints. On first load you'll see a picker prompting you to
**Open .duckdb** — pick a PEGASUS-built file and the app reads + writes against
it directly.

## Build

```bash
npm run build
```

Outputs static assets to `dist/`. Deployable to any static host (GitHub Pages,
Cloudflare Pages, plain S3+CloudFront, etc.).

For non-default deploy paths, override `VITE_BASE_PATH` at build time:

```bash
VITE_BASE_PATH=/some/other/path/ npm run build
```

## Architecture

Single data path: `DuckDBWasmDataSource` runs SQL against a user-attached
`.duckdb` file via the `BROWSER_FSACCESS` protocol.

- **`src/data/`** — DataSource interface, DuckDB-WASM adapter, OPFS persistence,
  schema migrations.
- **`src/data/migrations/`** — numbered SQL migrations applied idempotently on
  every connect. The DB itself is the source of truth for config (no
  `v2f.yaml` involvement).
- **`src/data/queries/`** — shared SQL builders consumed by the React Query
  hooks in `src/api/`.
- **`src/api/`** — thin React Query hook layer. *Despite the folder name,
  nothing here calls a server.* It's the data-layer namespace for the UI.
- **`src/pages/`** — top-level route components.
- **`src/components/`** — shared UI components.

Plans:
- `plans/2026-05-06-datasource-abstraction-standalone-ui.md` — DataSource design
- `plans/2026-05-07-db-first-config-architecture.md` — DB-first config schema
  (replaces the legacy `v2f.yaml` model)

## Status

- ✓ Schema migrations + DB-first config
- ✓ Read paths (genes, sources, studies, traits, loci) backed by `config.*` and `main.*` tables
- ✓ Plain SQL writes (source delete, source patch, metadata edits) — persist to the picked file
- ⏳ Pipeline ops (import, materialize, source build) — pending JS port (Phase 1c)
- ⏳ Schema-driven config forms — pending (Phase 2)
