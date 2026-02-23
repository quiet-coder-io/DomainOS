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

### Completed beyond v0.1
- **Multi-provider LLM support** — Anthropic, OpenAI, and Ollama (local) with per-domain model selection
- **Cross-domain features** — directed domain relationships with dependency types (blocks, depends_on, informs, parallel, monitor_only) + sibling relationships
- **Portfolio health briefing** — computed health scoring, cross-domain alerts, LLM-powered analysis with streaming, snapshot hashing for stale detection
- **Browser ingestion pipeline** — Chrome extension → localhost intake server → AI classification
- **KB file watching** — filesystem monitoring with debounced auto-scan on domain switch
- **Strategic advisory system** — mode-classified responses (brainstorm/challenge/review/scenario/general), persistent advisory artifacts with strict Zod-validated JSON fence blocks, 4 read-only advisory tools, deterministic task extraction, cross-domain contamination guard
- **Decision quality gates** — confidence, horizon, reversibility class, category, authority source tier on decision records

### Out of scope (future)
- Protocol marketplace/sharing

## Post-v0.1 Completed Features

### Browser-to-App Ingestion Pipeline (Completed)
Chrome Extension → localhost HTTP listener (Electron main process, token-authenticated) → AI domain classifier → user confirms classification → KB ingestion.

### Portfolio Health Briefing (Completed)
Computed dashboard: per-domain health scoring (KB staleness × tiered importance, open gap flags, dependency status), cross-domain alerts (stale/blocked domain impacting dependents), snapshot hashing. LLM interpretive layer: streams structured analysis (alerts, prioritized actions, monitors) from health snapshot + KB digests.

### Cross-Domain Relationships (Completed)
Directed relationships with typed dependencies (`blocks`, `depends_on`, `informs`, `parallel`, `monitor_only`). Supports reciprocal relationships with different types per direction. Powers cross-domain alerts in portfolio health.

## Key Files Reference

### Core Library (`packages/core/`)

| File | Purpose |
|------|---------|
| `src/domains/` | Domain CRUD, config schema (incl. `allowGmail`, `modelProvider`, `modelName`, `forceToolAttempt`) |
| `src/domains/schemas.ts` | Zod schemas for domain create/update with per-domain LLM overrides |
| `src/domains/repository.ts` | SQLite CRUD for domains, `DOMAIN_COLUMNS`, `rowToDomain()` |
| `src/domains/relationships.ts` | `DomainRelationshipRepository` — directed relationships with `DependencyType` (blocks/depends_on/informs/parallel/monitor_only), reciprocation, `RelationshipView` |
| `src/kb/` | KB file indexing, digest generation, tiered importance |
| `src/protocols/` | Protocol parsing and composition |
| `src/briefing/portfolio-health.ts` | `computePortfolioHealth()`, `DomainStatus`, `DomainHealth`, `StaleSummary`, `CrossDomainAlert`, snapshot hashing |
| `src/briefing/prompt-builder.ts` | `buildBriefingPrompt()`, `projectPortfolioHealthForLLM()`, token budget compression, `redactForLLM()` |
| `src/briefing/output-parser.ts` | `parseBriefingAnalysis()` — multiline-tolerant fence block parser for alerts/actions/monitors with diagnostics |
| `src/agents/provider.ts` | **Authoritative LLM contract**: `LLMProvider`, `ToolCapableProvider`, `ToolUseMessage` discriminated union, `ToolUseResponse`, `ToolsNotSupportedError`, tool capability cache (4-state), `shouldUseTools()` routing |
| `src/agents/anthropic-provider.ts` | Anthropic (Claude) implementation — streaming chat + tool-use via normalized interface |
| `src/agents/openai-provider.ts` | OpenAI (GPT-4o, o3-mini) implementation — streaming chat + tool-use; base class for Ollama |
| `src/agents/ollama-provider.ts` | Ollama (local LLMs) — extends OpenAI provider with custom baseURL + native `/api/tags` for model listing |
| `src/agents/provider-factory.ts` | `createProvider()` factory, `KNOWN_MODELS`, `DEFAULT_MODELS`, `ProviderName` type |
| `src/agents/prompt-builder.ts` | System prompt construction from domain config + KB digest + protocols + advisory mini-protocol |
| `src/advisory/` | Advisory system: parser, repository, schemas, task extractor, enum normalization |
| `src/advisory/parser.ts` | Strict JSON fence block parser — multi-block extraction, Zod `.strict()` validation, control/payload split, layered rate limiting, fingerprint dedup, parser telemetry |
| `src/advisory/repository.ts` | Advisory artifact CRUD — create (with fingerprint idempotency + rate limits), getByDomain, archive/unarchive, rename, countTodayByDomain, countThisHourByDomain |
| `src/advisory/schemas.ts` | Zod schemas for 4 advisory types (brainstorm, risk_assessment, scenario, strategic_review) with nested `.strict()` on array items |
| `src/advisory/task-extractor.ts` | Deterministic task extraction from artifacts — type-specific field mapping, title validation (6-120 chars, verb check), `needsEditing[]` for rejected candidates |
| `src/advisory/normalize.ts` | Centralized `normalizeEnum()`, `normalizePersist()`, `normalizeType()`, `validateEnum()` — shared by advisory and decision parsers |
| `src/storage/` | SQLite schema, migrations (v1–v12). v8: per-domain model override. v9: directed relationships. v11: decision quality columns. v12: advisory_artifacts table |
| `src/common/` | Result type, shared Zod schemas |

### Integrations (`packages/integrations/`)

| File | Purpose |
|------|---------|
| `src/gmail/` | `GmailClient` (search/read), `GmailPoller`, body parser |
| `src/gtasks/client.ts` | `GTasksClient` (listTaskLists, search, read, completeTask, updateTask, deleteTask, getOverdue) — on-demand Google Tasks API v1, read-write |

### Desktop App (`apps/desktop/`)

| File | Purpose |
|------|---------|
| `src/main/ipc-handlers.ts` | 60+ IPC handlers: domains, KB, chat, briefing, intake, protocols, sessions, relationships, gap flags, decisions, audit, advisory, Gmail, GTasks, settings |
| `src/main/tool-loop.ts` | **Provider-agnostic** tool-use loop — works with Anthropic, OpenAI, Ollama; prefix-based dispatch (`gmail_*`, `gtasks_*`, `advisory_*`), ROWYS Gmail guard, tool output sanitization, transcript validation, size guards (75KB/result, 400KB total), capability cache management |
| `src/main/advisory-tools.ts` | `ADVISORY_TOOLS` as `ToolDefinition[]` (advisory_search_decisions, advisory_search_deadlines, advisory_cross_domain_context, advisory_risk_snapshot), executors with output caps (10 items, 300 char truncation), `schemaVersion` wrapper |
| `src/main/gmail-tools.ts` | `GMAIL_TOOLS` as `ToolDefinition[]` (provider-agnostic), input validation, executor |
| `src/main/gmail-oauth.ts` | OAuth PKCE flow via system browser + loopback |
| `src/main/gmail-credentials.ts` | Encrypted credential storage (safeStorage) |
| `src/main/gtasks-tools.ts` | `GTASKS_TOOLS` as `ToolDefinition[]` (gtasks_search, gtasks_read, gtasks_complete, gtasks_update, gtasks_delete), input validation, executor |
| `src/main/gtasks-oauth.ts` | Google Tasks OAuth PKCE flow — scope `tasks` (read-write), falls back to Gmail client ID/secret |
| `src/main/gtasks-credentials.ts` | Encrypted GTasks credential storage (`gtasks-creds.enc`, safeStorage) |
| `src/main/kb-watcher.ts` | Filesystem monitoring for KB directories — `startKBWatcher()`, `stopKBWatcher()`, debounced (500ms), sends `kb:files-changed` to renderer |
| `src/preload/api.ts` | IPC type contract: `DomainOSAPI`, `ProviderConfig`, `ProviderKeysStatus`, `ToolTestResult`, `PortfolioHealth`, `BriefingAnalysis` |
| `src/renderer/components/SettingsDialog.tsx` | Multi-provider settings modal (API keys, Ollama connection, model defaults, tool test) |
| `src/renderer/pages/DomainChatPage.tsx` | Chat page with per-domain model override UI (tri-state: global default / override / clear) |
| `src/renderer/pages/BriefingPage.tsx` | Portfolio health dashboard + LLM analysis streaming UI with alerts, actions, monitors + GTasks connect/disconnect + overdue badge |
| `src/renderer/stores/settings-store.ts` | Zustand store for provider keys (boolean+last4), global config, Ollama state |
| `src/renderer/stores/domain-store.ts` | Zustand store for domains including `modelProvider`, `modelName`, `forceToolAttempt` |
| `src/renderer/stores/advisory-store.ts` | Zustand store for advisory artifacts: fetch, filter (status/type), archive/unarchive, rename |
| `src/renderer/stores/briefing-store.ts` | Zustand store: `fetchHealth()`, `analyze()` with streaming + cancel, snapshot hash stale detection |
| `src/renderer/components/AdvisoryPanel.tsx` | Strategic History panel — status/type filters, expandable artifact cards, type-specific content renderers, archive/unarchive actions |

## Multi-Provider LLM Architecture

### Provider System

Three providers, one normalized interface:
- **Anthropic** (`AnthropicProvider`) — uses `@anthropic-ai/sdk`, native Anthropic content blocks for tool-use
- **OpenAI** (`OpenAIProvider`) — uses `openai` SDK, native OpenAI message format for tool-use
- **Ollama** (`OllamaProvider`) — extends `OpenAIProvider` with `baseURL: http://localhost:11434/v1`; uses native Ollama `/api/tags` for model listing

All implement `ToolCapableProvider` interface with `createToolUseMessage()` for tool-use rounds.

### Message Round-Tripping

Each provider's `rawAssistantMessage` is an opaque blob preserving the native format:
- Anthropic: `ContentBlock[]` (text blocks + tool_use blocks)
- OpenAI/Ollama: `ChatCompletionMessage` (includes `tool_calls` array)

**Critical**: `rawMessage` is the source of truth for round-tripping. `derivedText` is for UI display only.

### Tool-Use Flow

```
Domain config → resolve provider (per-domain override or global default)
  ↓
shouldUseTools() → interface check + capability cache + forceToolAttempt flag
  YES → runToolLoop() with ToolDefinition[]
        → catch ToolsNotSupportedError → chatComplete() fallback
  NO  → streaming chat path
```

### Tool Capability Cache (In-Memory, 4-State)

```
type ToolCapability = 'supported' | 'not_observed' | 'not_supported' | 'unknown'
Key: ${providerName}:${model} (or ${providerName}:${model}:${ollamaBaseUrl} for Ollama)
```

- `supported`: successful tool call + result round-trip observed
- `not_observed`: model ignores tools (2 consecutive rounds)
- `not_supported`: provider rejects tool fields or ToolsNotSupportedError thrown
- `unknown`: never probed — try tools on first request

### Per-Domain Model Override

Database columns (migration v8): `model_provider TEXT`, `model_name TEXT`, `force_tool_attempt INTEGER` (latest migration: v12 — advisory artifacts)
- NULL = use global default
- Override = specific provider + model
- `forceToolAttempt` = try tools even when cache says `not_observed`

### Key Design Rules

- **D6**: Tool rounds always non-streaming (full response objects needed for round-tripping)
- **D8**: ROWYS (read-only-what-you-searched) Gmail guard lives in tool-loop, not provider adapters
- **D11**: `flattenForChatComplete()` converts `ToolUseMessage[]` → `ChatMessage[]` for fallback; one user message per tool result, never merged
- **D12**: Tool result size guards — 75KB/result, 400KB total transcript (byte-based)
- **D13**: Transcript validation before each `createToolUseMessage()` call
- **D14**: Capability cache per (provider, model); Ollama key includes baseUrl
- **D16**: Ollama malformed tool_calls → `ToolsNotSupportedError` → fallback
- **D18**: Tool output sanitization (strip auth headers, API keys, long base64)
- **D19**: `structuredClone(tool.inputSchema)` before adapter conversion

### API Key Storage

Per-provider encrypted files: `api-key-anthropic.enc`, `api-key-openai.enc` (Ollama needs no key).
Decrypted keys cached in-memory after first read. Keys never cross IPC to renderer — only `hasKey: boolean` + `last4: string` exposed.

### Provider Config

`provider-config.json` (versioned, no secrets):
```json
{ "version": 1, "defaultProvider": "anthropic", "defaultModel": "claude-sonnet-4-20250514", "ollamaBaseUrl": "http://localhost:11434" }
```

### IPC Channels (Provider-Related)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `settings:set-provider-key` | renderer→main | Encrypt + store API key |
| `settings:clear-provider-key` | renderer→main | Delete encrypted key file |
| `settings:get-provider-keys-status` | renderer→main | Batch: `{ hasKey, last4 }` per provider |
| `settings:get-provider-config` | renderer→main | Load global defaults |
| `settings:set-provider-config` | renderer→main | Save global defaults |
| `settings:list-ollama-models` | renderer→main | Fetch installed models via `/api/tags` |
| `settings:test-ollama` | renderer→main | Connection test |
| `settings:test-tools` | renderer→main | Two-round tool capability probe |
| `briefing:portfolio-health` | renderer→main | Compute health across all domains |
| `briefing:analyze` | renderer→main | Stream LLM briefing analysis (with requestId for cancel) |
| `briefing:analyze-cancel` | renderer→main | Cancel active briefing analysis |
| `briefing:analysis-chunk` | main→renderer | Streaming chunk event during analysis |
| `kb:files-changed` | main→renderer | KB watcher detected file changes |
| `gtasks:start-oauth` | renderer→main | Start Google Tasks OAuth PKCE flow |
| `gtasks:check-connected` | renderer→main | Check GTasks connection status |
| `gtasks:disconnect` | renderer→main | Disconnect GTasks + revoke token |
| `gtasks:complete-task` | renderer→main | Mark a task as completed |
| `gtasks:delete-task` | renderer→main | Delete a task |
| `gtasks:update-task` | renderer→main | Update task title/notes/due |
| `advisory:list` | renderer→main | List advisory artifacts by domain with status/type filters |
| `advisory:archive` | renderer→main | Archive an advisory artifact |
| `advisory:unarchive` | renderer→main | Unarchive an advisory artifact |
| `advisory:rename` | renderer→main | Rename an advisory artifact title |
| `advisory:save-draft-block` | renderer→main | 1-click save of a `persist:"no"` draft block from message metadata |
| `advisory:extract-tasks` | renderer→main | Deterministic task extraction from an artifact |

## Environment Variables

Gmail/GTasks OAuth credentials are loaded from `apps/desktop/.env` (gitignored). Required for integrations:

```
MAIN_VITE_GMAIL_CLIENT_ID=<your-gcp-oauth-client-id>
MAIN_VITE_GMAIL_CLIENT_SECRET=<your-gcp-oauth-client-secret>
# Optional: GTasks-specific overrides (falls back to Gmail vars if not set)
# MAIN_VITE_GTASKS_CLIENT_ID=<your-gcp-oauth-client-id>
# MAIN_VITE_GTASKS_CLIENT_SECRET=<your-gcp-oauth-client-secret>
```

These come from a GCP project with a Desktop/Native app OAuth client and `gmail.readonly` + `tasks` scopes enabled. Without these, connect will show a clear error; all other features work normally.

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
