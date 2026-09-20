# OrbitoDB

> A fast, local-first database workbench built with Rust, Tauri and React.

OrbitoDB is a desktop-first database client for developers who want a lightweight alternative to traditional database GUI tools. Connections and queries stay local, credentials are handled by the operating system credential store, and the desktop app talks to databases directly from Rust.

## Current support

- PostgreSQL
- MySQL / MariaDB
- SQLite

## What already works

- connection management
- schema and table browsing
- SQL editor with schema-aware completion
- query history
- result grid and export
- inline row editing
- visual table operations
- statistics and chart views
- local SQLite creation
- Tauri desktop runtime
- optional browser + bridge runtime

## Where OrbitoDB is going

The goal is a clean, native-feeling database workbench with the everyday capabilities people expect from tools such as Navicat, without requiring an account or a cloud service.

Next areas of work:

- complete desktop UI/UX redesign
- stronger driver abstraction
- SQL Server, Redis and Oracle
- TiDB, OceanBase and other domestic database engines
- import / export workflows
- SSH tunnel and proxy support
- ER diagrams and schema diff
- safer destructive-operation flows
- connection groups, favorites and workspace persistence

## Stack

```text
Tauri 2
├── Rust 2021
├── SQLx 0.8 + Tokio
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

Rust tests:

```bash
cd src-tauri
cargo test
```

Production build:

```bash
npm run tauri build
```

## Local-first

The desktop build connects directly to databases from the Rust backend. No OrbitoDB account is required. Database passwords are stored through the operating system credential service instead of plain-text project configuration.

## Origin

OrbitoDB started from [MamaSQL](https://github.com/fizzexual/MamaSQL) by Stiliyan Stoyanov and is being developed as an independent database client.

The original MIT license notice is retained. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## License

MIT
