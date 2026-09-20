# OrbitoDB

> A fast, local-first database workbench built with Rust, Tauri and React.

OrbitoDB is a desktop-first database client for developers who want a lightweight alternative to traditional database GUI tools. Connections and queries stay local, credentials are handled by the operating system credential store, and the desktop app talks to databases directly from Rust.

## Current support

- PostgreSQL
- MySQL / MariaDB
- SQLite

## What already works

- saved connection profiles with groups and environment labels
- PostgreSQL schema selection and switching
- optional TLS/SSL for PostgreSQL and MySQL/MariaDB with native root certificates
- optional SSH tunneling through the system OpenSSH client
- PostgreSQL / MySQL connection URL import, including common SSL parameters
- local credential storage through the OS keychain
- database / schema / table browsing
- column, foreign-key and index introspection
- ER diagrams and schema diff
- multi-tab SQL editor with persistent tab names
- schema-aware SQL completion
- query history, Scripts and Starred queries
- result grid, sorting, filtering and export
- inline row editing and row operations
- table structure editing
- engine-aware DDL templates for indexes and foreign keys
- production write guard and per-connection read-only mode
- local SQLite database creation
- optional browser + local bridge runtime

## TLS / SSL

Desktop PostgreSQL and MySQL/MariaDB connections can opt into TLS without changing the default behavior of existing profiles.

- default mode is **Disabled**
- PostgreSQL supports Disable / Allow / Prefer / Require / Verify CA / Verify Full
- MySQL supports Disabled / Preferred / Required / Verify CA / Verify Identity through the shared profile modes
- certificate verification uses the system root store by default
- an optional custom CA certificate path can be configured
- PostgreSQL `sslmode` / `sslrootcert` and MySQL `ssl-mode` / `ssl-ca` URL parameters are imported
- TLS profile controls are desktop-only; the browser bridge does not pretend to provide equivalent TLS policy controls

`Verify Full` / `Verify Identity` is intentionally blocked when OrbitoDB's local SSH forwarding is enabled, because the database driver connects to `127.0.0.1` and hostname verification would no longer match the original database host.

## SSH tunneling

The desktop app can connect to PostgreSQL or MySQL/MariaDB through a local SSH tunnel.

OrbitoDB uses the system `ssh` command instead of embedding a separate SSH stack:

- local forwarding uses an ephemeral `127.0.0.1` port
- authentication supports `ssh-agent` or a private-key path
- interactive password / passphrase prompts are intentionally disabled
- encrypted private keys should already be loaded into `ssh-agent`
- host keys use OpenSSH `StrictHostKeyChecking=accept-new`
- OrbitoDB does not store SSH passphrases
- the tunnel process is terminated when the database connection closes

Database passwords are still stored separately in the operating system credential store.

## Project direction

The goal is a clean, native-feeling database workbench with the everyday capabilities expected from tools such as Navicat, while remaining local-first and account-free.

Next areas of work:

- SQL Server, Redis and Oracle
- TiDB, OceanBase and other domestic database engines
- richer import / export workflows
- migration preview and schema migration generation
- cross-table data search
- richer constraint and index editing
- SSH proxy / jump-host improvements
- TLS client-certificate support
- connection health diagnostics
- packaging, signing and release automation

## Stack

```text
Tauri 2
├── Rust 2021
├── SQLx 0.8 + Tokio
├── system OpenSSH
└── OS credential store

React 19
├── TypeScript
├── Vite
├── CodeMirror 6
├── Zustand
└── Mantine
```

## Development

```bash
npm install
npm run tauri dev
```

Run frontend and Rust validation:

```bash
npm run build
cd src-tauri
cargo check
cargo test
```

Production build:

```bash
npm run tauri build
```

## Local-first

The desktop build connects directly to databases from the Rust backend. No OrbitoDB account is required.

Saved connection metadata stays in OrbitoDB's local application database. Database passwords are stored through the operating system credential service rather than plain-text project configuration.

## Origin

OrbitoDB started from [MamaSQL](https://github.com/fizzexual/MamaSQL) by Stiliyan Stoyanov and is being developed as an independent database client.

The original MIT license notice is retained. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## License

MIT
