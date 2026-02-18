# Security Model

DomainOS is designed with a local-first security posture. Your data never leaves your machine unless you explicitly send a chat message to your configured LLM API provider.

---

## Data Locality

| Data | Storage | Location |
|------|---------|----------|
| Domain configs | SQLite | `~/.domain-os/data.db` |
| Knowledge base files | Filesystem | User-specified directories |
| API keys | Electron `safeStorage` | Encrypted file in app userData, encryption key backed by OS keychain |
| App settings | SQLite | `~/.domain-os/data.db` |
| Chat history | SQLite | `~/.domain-os/data.db` |

## Bring Your Own Key (BYOK)

- Users provide their own LLM API keys (OpenAI, Anthropic, etc.)
- Keys are encrypted via Electron's `safeStorage` API — the encryption key is managed by the OS keychain (macOS Keychain / Windows DPAPI / Linux Secret Service)
- The encrypted data is stored in a file within the Electron userData directory
- **Note:** On Linux systems without a supported keyring, `safeStorage` may fall back to plaintext storage. DomainOS logs a warning at startup if this is detected.
- Keys are decrypted only when making API calls
- No proxy server — API calls go directly from the app to the provider

## Electron Security

- **`contextIsolation: true`** — renderer cannot access Node.js APIs directly
- **`nodeIntegration: false`** — no `require()` in renderer
- **`sandbox: true`** — preload scripts run in a sandboxed environment; only `contextBridge` and `ipcRenderer` are used
- **Content Security Policy** — restricts script sources to `'self'`
- **External links** — opened in default browser, not in-app

## Localhost Intake Server

DomainOS runs a localhost-only HTTP server on `127.0.0.1:19532` for the Chrome extension intake pipeline:

- **Bound to `127.0.0.1` only** — not accessible from other machines on the network
- **Token-authenticated** — every request (except health check) requires a Bearer token
- **Per-IP rate limited** — max 30 requests/minute per remote address
- **No CORS wildcard** — browser same-origin policy blocks web pages; the Chrome extension bypasses CORS via `host_permissions` in its manifest
- **Content-Type enforced** — POST requests must send `application/json`
- **Request timeouts** — headers timeout (10s) and request timeout (30s) to prevent slow-loris attacks

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Data exfiltration | All data is local; no telemetry, no cloud sync |
| API key theft | Electron `safeStorage` encryption backed by OS keychain |
| Renderer compromise (XSS) | CSP, contextIsolation, sandbox, no nodeIntegration |
| Path traversal via KB proposals | Resolve + boundary check + symlink escape detection + extension allowlist |
| Malicious protocol injection | Protocols are user-authored local files, not downloaded |
| Intake server abuse | Localhost-only binding, token auth, rate limiting, request timeouts |
| Supply chain attack | Minimal dependencies, lockfile integrity |

## What DomainOS Does NOT Do

- **Does not phone home** — no analytics, telemetry, or usage tracking
- **Does not store keys in plaintext** — API keys are encrypted via `safeStorage` (with OS keychain backing)
- **Does not expose network ports** — the intake server binds to `127.0.0.1` only (loopback); it is not reachable from other devices
- **Does not auto-update silently** — update checks are opt-in
- **Does not access domains you haven't configured** — filesystem access is scoped to configured KB paths

## How to Verify Local-Only

You can independently verify that DomainOS only communicates with `localhost` and your LLM provider:

1. **macOS:** Install [LuLu](https://objective-see.org/products/lulu.html) or [Little Snitch](https://www.obdev.at/products/littlesnitch/) — these firewall monitors show all outbound connections
2. **Windows:** Use [GlassWire](https://www.glasswire.com/) or Windows Firewall with logging enabled
3. **Linux:** Use `ss -tlnp` to check listening ports, and `tcpdump` or `nethogs` to monitor connections

**Expected traffic:**
- `127.0.0.1:19532` — intake server (localhost only, Chrome extension communication)
- Your LLM API provider (e.g., `api.anthropic.com`, `api.openai.com`) — only when you send a chat message
- **Nothing else.** If you see other outbound connections, something is wrong.
