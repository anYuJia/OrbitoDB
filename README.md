# OrbitoDB

> A fast, local-first database workbench built with Rust, Tauri, React and SQLx.

[简体中文](README.zh-CN.md) · [Security](SECURITY.md)

OrbitoDB is a desktop-first database client for PostgreSQL, MySQL/MariaDB and SQLite. It focuses on everyday workflows expected from tools such as Navicat while keeping connections, credentials and query execution local to the user's machine.

## Highlights

- PostgreSQL, MySQL / MariaDB and SQLite
- native Tauri desktop app for Windows, macOS and Linux
- saved connection profiles, groups, environment labels and Read-only mode
- OS keychain credential storage on desktop
- PostgreSQL schema discovery and switching
- TLS/SSL, custom CA and system OpenSSH tunneling
- PostgreSQL / MySQL connection URL import
- real object tree: tables, views, indexes, triggers, sequences, functions and procedures
- rich Columns / PK / UNIQUE / CHECK / FK / Index metadata
- multi-tab SQL editor with connection affinity and schema-aware completion
- History, Scripts and Starred queries
- result paging, sorting, filtering, editing and export
- CSV / TSV import with mapping and transactional bulk insert
- table structure editing and review-first SQLite rebuilds
- ER diagram, Schema Diff and Migration Preview
- cross-table data search
- engine-aware Explain / Explain Analyze and query cancellation
- managed SQLite snapshots with integrity-checked restore
- PostgreSQL / MySQL native backup-command generation
- engine-aware Analyze / Vacuum / Optimize maintenance
- PROD write confirmation, diagnostics, crash recovery and bounded history/workspace state

## Security model

The desktop build connects directly to databases from Rust. No OrbitoDB account or cloud service is required.

- database passwords use the operating-system credential store
- SSH passphrases are never stored by OrbitoDB
- Read-only profiles block writes, maintenance and Explain Analyze
- production writes require explicit confirmation
- the Tauri webview uses an explicit Content Security Policy
- release artifacts include SHA-256 checksum files

### Browser + bridge mode

A browser cannot open PostgreSQL/MySQL TCP sockets directly, so OrbitoDB includes an optional local Node engine bridge.

- SQLite can run locally through sql.js
- PostgreSQL/MySQL use the local bridge
- the bridge listens on 127.0.0.1 by default
- disallowed browser Origins are rejected server-side
- requests must be JSON POSTs and have a bounded request size
- browser credentials persist only when Web Crypto is available in a secure context
- on insecure HTTP contexts, passwords remain memory-only for the current page session
- Docker publishes the Web UI on 127.0.0.1 by default

The browser/bridge deployment has no built-in user login. Do not expose it directly to an untrusted network; use a trusted VPN or authenticated reverse proxy for remote access.

## Database-specific behavior

### PostgreSQL
- schemas and search_path
- TLS and SSH tunneling
- functions, procedures, sequences and triggers
- JSON Explain and Explain Analyze
- backend query cancellation
- ANALYZE and VACUUM (ANALYZE)

### MySQL / MariaDB
- TLS and SSH tunneling
- functions, procedures and triggers
- MySQL EXPLAIN ANALYZE / MariaDB ANALYZE FORMAT=JSON
- KILL QUERY cancellation
- ANALYZE TABLE and OPTIMIZE TABLE

### SQLite
- local database creation
- table/view/index/trigger introspection
- review-first rebuild SQL for unsupported ALTER operations
- EXPLAIN QUERY PLAN
- managed snapshots with pre-restore safety backup and PRAGMA integrity_check
- ANALYZE, PRAGMA optimize and VACUUM

## Import / export

Import supports CSV/TSV auto-detection, quoted and multiline fields, column mapping, optional empty-string to NULL conversion, type inference, chunked multi-row inserts and rollback where transactions are supported.

Export supports CSV, TSV, JSON, Markdown and SQL INSERT.

## Releases

| Platform | Artifacts |
| --- | --- |
| Windows x64 | portable EXE, NSIS installer |
| macOS Apple Silicon | DMG |
| macOS Intel | DMG |
| Linux x64 | DEB, AppImage |

Every binary artifact has a matching .sha256 file. macOS CI packages use ad-hoc signing unless official Apple Developer signing/notarization credentials are configured.

## Stack

- Tauri 2 / Rust 2021 / SQLx 0.8 / Tokio
- system OpenSSH and OS credential store
- React 19 / TypeScript / Vite / CodeMirror 6 / Zustand / Mantine

## Development

Requirements: Node.js 24, stable Rust and the platform dependencies required by Tauri 2.

    npm ci
    npm run tauri dev

Core validation:

    npm run test:ci
    npm run check:quality
    npm run audit:security
    npm run check:bridge
    npm run check:release
    npm run build
    cargo check --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml --lib

Web + bridge:

    npm start

Docker:

    docker compose up -d

The Docker Web UI binds to localhost by default. Change BIND_ADDR only when network exposure is intentional.

## Reliability

- up to 24 open SQL tabs
- up to 200 Scripts
- up to 200 Starred queries
- up to 1000 query-history entries

A root error boundary provides reload and SQL-workspace-reset recovery without deleting database files or saved connection profiles.

## Project direction

The current PostgreSQL / MySQL / MariaDB / SQLite workbench is intended for daily local use. Future expansion can focus on additional engines and official platform signing/notarization rather than placeholder UI.

Potential future engines include SQL Server, Redis, Oracle, TiDB and OceanBase.

## Origin

OrbitoDB started from [MamaSQL](https://github.com/fizzexual/MamaSQL) by Stiliyan Stoyanov and is now developed as an independent database client.

The original MIT license notice is retained. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## License

MIT
