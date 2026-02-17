# Security Model

DomainOS is designed with a local-first security posture. Your data never leaves your machine unless you explicitly choose to share it.

## Data Locality

| Data | Storage | Location |
|------|---------|----------|
| Domain configs | SQLite | `~/.domain-os/data.db` |
| Knowledge base files | Filesystem | User-specified directories |
| API keys | OS keychain | macOS Keychain / Windows Credential Manager |
| App settings | SQLite | `~/.domain-os/data.db` |
| Chat history | SQLite | `~/.domain-os/data.db` |

## Bring Your Own Key (BYOK)

- Users provide their own LLM API keys (OpenAI, Anthropic, etc.)
- Keys are stored in the OS keychain — never in plaintext, never in the database
- Keys are read from keychain only when making API calls
- No proxy server — API calls go directly from the app to the provider

## Electron Security

- **`contextIsolation: true`** — renderer cannot access Node.js APIs directly
- **`nodeIntegration: false`** — no `require()` in renderer
- **`sandbox: false`** (preload only) — preload scripts bridge main ↔ renderer via `contextBridge`
- **Content Security Policy** — restricts script sources to `'self'`
- **External links** — opened in default browser, not in-app

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Data exfiltration | All data is local; no telemetry, no cloud sync |
| API key theft | OS keychain storage, never persisted in files |
| Renderer compromise (XSS) | CSP, contextIsolation, no nodeIntegration |
| Malicious protocol injection | Protocols are user-authored local files, not downloaded |
| Supply chain attack | Minimal dependencies, lockfile integrity |

## What DomainOS Does NOT Do

- **Does not phone home** — no analytics, telemetry, or usage tracking
- **Does not store keys in files** — API keys live in OS keychain only
- **Does not run a server** — no HTTP endpoints, no open ports
- **Does not auto-update silently** — update checks are opt-in
- **Does not access domains you haven't configured** — filesystem access is scoped to configured paths
