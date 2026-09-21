# Security Policy

## Supported versions

OrbitoDB is under active development. Security fixes target the latest release and the current main branch.

| Version | Supported |
| --- | --- |
| latest release | ✅ |
| current main | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

Do not open a public issue for a security vulnerability.

Use GitHub Private Vulnerability Reporting:
https://github.com/anYuJia/OrbitoDB/security/advisories/new

Please include:
- impact and affected component
- reproduction steps or a minimal proof of concept
- whether the issue affects desktop/Tauri, browser/bridge, Docker or release packaging
- any suggested remediation

## Security model

### Desktop

- database credentials are stored through the operating-system credential service
- database connections are opened directly by the Rust backend
- OrbitoDB does not require a cloud account
- SSH passphrases are not stored
- the Tauri WebView uses an explicit CSP
- Read-only mode blocks writes, maintenance and Explain Analyze
- production mutations require explicit confirmation

### Browser / engine bridge

The optional browser deployment uses a local Node bridge for PostgreSQL/MySQL.

- the bridge binds to 127.0.0.1 by default
- Docker keeps the bridge inside the private compose network
- Docker publishes the Web UI to 127.0.0.1 by default
- browser Origins outside the configured allowlist are rejected before endpoint execution
- only JSON POST requests are accepted
- request bodies are size-limited
- secure browser contexts can persist credentials using AES-GCM with a non-extractable key stored in IndexedDB
- insecure HTTP contexts keep credentials in memory only; OrbitoDB does not fall back to reversible Base64/plaintext persistence

The Web/Bridge deployment does not provide a built-in multi-user authentication layer. Do not publish it directly to an untrusted network. Use a trusted VPN or an authenticated TLS reverse proxy for remote access.

## Dependency and release security

- pull requests run npm production high+ and all-dependency critical audits
- Rust dependencies are checked with cargo-audit / RustSec
- dependency audits also run on a weekly schedule
- release publishing requires the shared frontend, bridge, release-config and Rust validation gates
- release packages include SHA-256 checksum files
- Docker images are built through GitHub Actions

macOS CI artifacts currently use ad-hoc signing unless official Apple Developer signing/notarization credentials are configured. Windows release artifacts are not code-signed unless signing credentials are configured.

## High-interest report areas

Reports concerning the following are especially useful:
- credential persistence or keychain handling
- SQL identifier/literal escaping
- Read-only or production-guard bypasses
- bridge Origin/CORS/request validation
- SSH/TLS handling
- SQLite backup/restore path validation
- release/update supply-chain behavior

## Disclosure

After an issue is confirmed, fixes should be prepared before public technical details are disclosed. Reporters may be credited unless anonymity is requested.
