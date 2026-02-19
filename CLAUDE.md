# CLAUDE.md — DomainOS Development Guide

## Monorepo Structure

```
domain-os/
├── packages/core/           → @domain-os/core          (framework-agnostic library)
├── packages/integrations/   → @domain-os/integrations   (Gmail client, poller, body parser)
├── apps/desktop/            → @domain-os/desktop        (Electron + React app)
└── npm workspaces           → linked via root package.json
```

## Quick Commands

```bash
npm run dev          # Start Electron app in dev mode
npm run build        # Build core, then desktop
npm run test         # Run all tests
npm run typecheck    # Type-check all packages
npm run clean        # Remove all build artifacts and node_modules
```

Per-package:
```bash
cd packages/core && npm test              # Core tests only
cd packages/core && npm run test:watch    # Core tests in watch mode
cd apps/desktop && npm run dev            # Desktop dev only
```

## Architecture Decisions

### npm workspaces (not pnpm)
Matches the existing project setup. No phantom dependency issues at this scale.

### Core is framework-agnostic
`@domain-os/core` has zero React/Electron dependencies. It runs in Node (main process) and could theoretically be used in a CLI or web app. All UI concerns live in `apps/desktop/`.

### Electron process separation
- **Main process** (`src/main/`) — Node.js, accesses filesystem/SQLite/keychain, imports `@domain-os/core`
- **Preload** (`src/preload/`) — bridge between main and renderer via `contextBridge`
- **Renderer** (`src/renderer/`) — React app, no direct Node.js access, communicates via IPC

Data flow: Renderer → IPC → Main → Core → SQLite/Filesystem

### Two tsconfigs in core
- `tsconfig.json` — IDE config, includes `src/` + `tests/`
- `tsconfig.build.json` — emit config, excludes tests, used by `npm run build`

## v0.1 Core Loop

The minimum viable feature set:

1. **KB ingestion** — Point a domain at a folder, index its knowledge base files
2. **Prompt construction** — Build a system prompt from domain config + KB digest + protocols
3. **Chat interface** — Send messages to an LLM with the constructed context
4. **Propose KB updates** — AI suggests edits to knowledge base files; user approves/rejects

This loop validates the core value prop: domain-scoped AI that reads and writes your knowledge base.

### Out of scope for v0.1
- Multi-provider LLM support (start with one: Anthropic or OpenAI)
- Cross-domain features
- Protocol marketplace/sharing
- Auto-sync or real-time file watching
- Browser ingestion pipeline (see Post-v0.1 Roadmap)

## Post-v0.1 Roadmap

### Browser-to-App Ingestion Pipeline
Inspired by a prior project's Gmail Extension Pipeline. A Chrome Extension with a "Send to DomainOS" button that extracts content from web pages (starting with Gmail) and routes it to the desktop app for domain classification and KB ingestion.

**Architecture:** Chrome Extension → localhost HTTP listener (Electron main process) → domain classifier → KB update proposal. Unlike the prior project's approach (separate relay server + temp files + CLI launch), DomainOS can handle this natively — the Electron main process already runs Node.js and can accept localhost requests directly.

**Design considerations:**
- Localhost HTTP listener in main process (token-authenticated, localhost-only)
- Intake classifier in `@domain-os/core/agents` alongside the chat agent
- Domain routing UI in renderer (user confirms classification before ingestion)
- Structured extraction with excerpt/full modes and content-length guards

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/domains/` | Domain CRUD, config schema (incl. `allowGmail` toggle) |
| `packages/core/src/kb/` | KB file indexing, digest generation |
| `packages/core/src/protocols/` | Protocol parsing and composition |
| `packages/core/src/agents/` | LLM API calls, prompt builder, `createMessage()` for tool-use |
| `packages/core/src/storage/` | SQLite schema, migrations (v7: `allow_gmail`), queries |
| `packages/core/src/common/` | Result type, shared Zod schemas |
| `packages/integrations/src/gmail/` | `GmailClient` (search/read), `GmailPoller`, body parser |
| `apps/desktop/src/main/` | Electron main process, IPC handlers |
| `apps/desktop/src/main/gmail-oauth.ts` | OAuth PKCE flow via system browser + loopback |
| `apps/desktop/src/main/gmail-credentials.ts` | Encrypted credential storage (safeStorage) |
| `apps/desktop/src/main/gmail-tools.ts` | Tool definitions, input validation, executor |
| `apps/desktop/src/main/tool-loop.ts` | LLM ↔ tool execution loop (Anthropic tool-use API) |
| `apps/desktop/src/preload/` | contextBridge API surface |
| `apps/desktop/src/renderer/` | React UI, pages, components, stores |

## Environment Variables

Gmail OAuth credentials are loaded from `apps/desktop/.env` (gitignored). Required for Gmail integration:

```
MAIN_VITE_GMAIL_CLIENT_ID=<your-gcp-oauth-client-id>
MAIN_VITE_GMAIL_CLIENT_SECRET=<your-gcp-oauth-client-secret>
```

These come from a GCP project with a Desktop/Native app OAuth client and `gmail.readonly` scope enabled. Without these, Gmail connect will show a clear error; all other features work normally.

## Native Modules

`better-sqlite3` is a native addon compiled for either system Node (tests) or Electron (dev). Lifecycle hooks handle this automatically:

- `npm install` → defaults to system Node ABI (`postinstall`)
- `npm test` → ensures system Node ABI (`pretest`)
- `npm run dev` → ensures Electron ABI (`predev`, from root or desktop workspace)
- First `npm run dev` after install rebuilds for Electron (~5s with prebuilds)
- CI: set `ENSURE_NATIVE_SKIP=1` if binary is pre-cached in correct ABI
- Always prefer running `npm run dev` from repo root

## Conventions

- **ESM everywhere** — `"type": "module"`, use `.js` extensions in imports within core
- **Strict TypeScript** — `strict: true`, `verbatimModuleSyntax: true`
- **Barrel exports** — each module folder has `index.ts` re-exporting its public API
- **Zod for validation** — all data from external sources (files, DB, user input) is validated
- **Result pattern** — use `Result<T, E>` for operations that can fail; reserve `throw` for truly exceptional cases
- **Import paths** — renderer uses `@/*` alias; core uses relative paths with `.js` extension
- **Tests** — colocated in `tests/` directory per package, named `*.test.ts`
