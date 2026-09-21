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
npm ci
npm run tauri dev
```

Run the same verification gates used by CI:

```bash
npm test
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Production build:

```bash
npm run tauri build
```

Versioned desktop releases are built only from semantic-version tags such as
`v0.1.0`, after the frontend and Rust test suites pass.

## Local-first

The desktop build connects directly to databases from the Rust backend. No OrbitoDB account is required. Database passwords are stored through the operating system credential service instead of plain-text project configuration.

The optional Docker/web runtime includes a database bridge and has no user
login. It binds to `127.0.0.1` by default; do not publish it to an untrusted
network. Set `BIND_ADDR` only when you deliberately want access from a trusted
LAN or VPN. Direct cross-origin bridge access is disabled unless an exact
origin is listed in `BRIDGE_ALLOWED_ORIGINS`.

## Origin

OrbitoDB started from [MamaSQL](https://github.com/fizzexual/MamaSQL) by Stiliyan Stoyanov and is being developed as an independent database client.

The original MIT license notice is retained. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## License

MIT
