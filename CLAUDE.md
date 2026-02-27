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
npm run dev              # Start Electron app in dev mode
npm run build            # Build core, then desktop
npm run test             # Run all tests
npm run typecheck        # Type-check all packages
npm run clean            # Remove all build artifacts and node_modules
npm run package:mac:arm64  # Package arm64 DMG + ZIP (Apple Silicon)
npm run package:mac:x64    # Package x64 DMG + ZIP (Intel)
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

### Packaging & Distribution

**Build pipeline:** `npm run build` (core → integrations → desktop via electron-vite) → `electron-builder` packages into DMG + ZIP.

**Separate arm64 + x64 builds** (not universal) — native `better-sqlite3` binary would double app size in a universal build. Architecture controlled by CLI flags (`--arm64` or `--x64`).

**Workspace symlink workaround:** `apps/desktop/scripts/package.mjs` strips workspace deps (`@domain-os/core`, `@domain-os/integrations`) from `package.json` before electron-builder runs, then restores them after. These packages are bundled by electron-vite (via `externalizeDepsPlugin({ exclude: [...] })`) so they don't need to exist in `node_modules` at runtime. Without this, electron-builder follows workspace symlinks to paths outside `apps/desktop/` and crashes.

**Auto-update:** `electron-updater` checks GitHub Releases 10s after launch and every 4 hours. Prompts user to download, then prompts to restart. Only active in packaged builds (`app.isPackaged`). Public repo — no token needed.

**Unsigned app (Phase 1):** `identity: null` in `electron-builder.yml` skips code signing. First launch requires right-click → Open. Phase 2 (Developer ID + notarization) will eliminate this.

**Key files:**
| File | Purpose |
|------|---------|
| `apps/desktop/electron-builder.yml` | Packaging config (targets, asar, publish) |
| `apps/desktop/scripts/package.mjs` | Workspace-aware packaging wrapper |
| `apps/desktop/src/main/updater.ts` | Auto-update lifecycle |
| `apps/desktop/build/entitlements.mac.plist` | macOS entitlements (scaffolded for Phase 2) |

**Release workflow:**
```bash
# 1. Bump version in apps/desktop/package.json
# 2. Build both architectures
npm run package:mac:arm64
mkdir -p apps/desktop/dist-arm64 && mv apps/desktop/dist/* apps/desktop/dist-arm64/
npm run package:mac:x64
mkdir -p apps/desktop/dist-x64 && mv apps/desktop/dist/* apps/desktop/dist-x64/
# 3. Create GitHub Release with all artifacts
gh release create v0.2.0 apps/desktop/dist-arm64/* apps/desktop/dist-x64/* --title "DomainOS v0.2.0" --draft
# 4. Verify, then publish
gh release edit v0.2.0 --draft=false
```

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
- **Gmail drag-and-drop** — drag emails from Gmail directly into chat as LLM context via Chrome extension content script with drag handles; subject encoded in URL query param (only reliable cross-app drag channel). Automatically extracts text from PDF, Excel, and Word attachments via main-process enrichment (5MB/att, 10K chars/att, 5 per message, 25 per thread). Unsupported/oversized attachments listed in skipped summary for LLM transparency.
- **KB file watching** — filesystem monitoring with debounced auto-scan on domain switch
- **Strategic advisory system** — mode-classified responses (brainstorm/challenge/review/scenario/general), persistent advisory artifacts with strict Zod-validated JSON fence blocks, 4 read-only advisory tools, deterministic task extraction, cross-domain contamination guard
- **Decision quality gates** — confidence, horizon, reversibility class, category, authority source tier on decision records
- **File attachments in chat** — drag-and-drop files onto chat as context for the LLM. Supports text files (.md, .ts, .json, etc.) and binary documents (PDF, Excel, Word) with server-side text extraction. Files are sent as user message preamble; only metadata (filename, size, sha256) stored in chat history. Budget enforcement: 100KB/file text, 2MB/file binary, 500KB total, 200K chars total, max 20 files. Hash-based dedup, encoding validation, deterministic truncation.
- **Skill library** — reusable analytical procedures (e.g., "CMBS loan review") with per-message activation, freeform/structured output, tool hints, import/export as `.skill.md` files, and full CRUD management dialog. Skills inject into the system prompt between shared protocols and domain protocols with protocol precedence enforcement.
- **Mission system** — reusable mission definitions with a 10-step lifecycle runner (validate → context → prompt → LLM → parse → persist → gate → actions → audit → finalize). Generalized runner with optional dep hooks (`buildContext`, `buildPrompts`, `shouldGate`, `buildEmailBody`, `buildEmailSubject`) — mission-specific logic injected at IPC layer. Data-driven mission metadata (`methodology`, `outputLabels`) for self-describing missions. Two seeded missions: Portfolio Briefing and Loan Document Review (CMBS methodology, attorney memo + risk heatmap). Dynamic parameter form from definition, mission selector, cancel-by-requestId, real Gmail draft creation. Per-run provenance (definition hash, prompt hash, context hash, model, KB digest timestamps). Per-domain enable/disable, run history, gate modal.

### Out of scope (future)
- Protocol marketplace/sharing

## Post-v0.1 Completed Features

### Browser-to-App Ingestion Pipeline (Completed)
Chrome Extension → localhost HTTP listener (Electron main process, token-authenticated) → AI domain classifier → user confirms classification → KB ingestion.

### Gmail Email Drag-and-Drop (Completed)
Drag emails from Gmail inbox directly into the DomainOS chat panel to attach them as LLM context. The Chrome extension injects drag handles (☰) on Gmail email rows that bypass Gmail's native drag blocking (`draggable="false"` + `preventDefault` on mousedown). On `dragstart`, the content script extracts the email subject via a 3-strategy heuristic (`data-thread-id` → `role="link"` → bold-text fallback) and encodes it as a `dominos_subject` query parameter in `text/uri-list` — the only MIME type whose value reliably survives macOS cross-app drag transfer (custom MIME types, `text/html`, and `text/plain` values are stripped or overwritten). The renderer extracts the subject from the URL, searches Gmail API (with `RE:`/`FW:` prefix stripping), and presents an email preview with Attach/Cancel. Falls back to manual subject search prompt when the extension isn't installed.

**Email attachment extraction**: When emails are fetched for context, the main process automatically extracts text from PDF, Excel (.xlsx/.xls), and Word (.docx) attachments before returning to the renderer. Two-phase approach: (1) deterministic pre-walk tags every attachment with eligibility (format support, size limits, per-message/thread caps) before any async work, preventing race conditions; (2) concurrency-limited (2) async extraction fetches raw data and extracts text via shared `text-extractor.ts` module (`unpdf`, `xlsx`, `mammoth`). Format detection: extension first, mimeType fallback. Budget enforcement: 5MB/attachment decoded size (gated on `buf.length`, not advisory `att.size`), 10K chars/attachment, 5 attachments/message, 20K total chars/message, 10MB total bytes/message, 25 eligible attachments/thread. Low-signal PDF guard skips scanned documents (<40 non-whitespace chars). Skipped attachments (unsupported format, too large, extraction failed, limit reached) listed in summary for LLM transparency. Preview modal shows attachment count badges (extracted in green, skipped count). `message/rfc822` (forwarded emails) explicitly skipped (v2 scope).

### Portfolio Health Briefing (Completed)
Computed dashboard: per-domain health scoring (KB staleness × tiered importance, open gap flags, dependency status), cross-domain alerts (stale/blocked domain impacting dependents), snapshot hashing. LLM interpretive layer: streams structured analysis (alerts, prioritized actions, monitors) from health snapshot + KB digests.

### Cross-Domain Relationships (Completed)
Directed relationships with typed dependencies (`blocks`, `depends_on`, `informs`, `parallel`, `monitor_only`). Supports reciprocal relationships with different types per direction. Powers cross-domain alerts in portfolio health.

### Strategic Brainstorming — BMAD Method (Completed)
Deep facilitated brainstorming sessions using 106 techniques (56 brainstorming + 50 elicitation) across 10 categories, adapted from BMAD-METHOD. AI facilitates (not generates), with heuristic technique recommendations, multi-round idea capture, anti-bias protocol, and deterministic synthesis (keyword clustering → ranked options). One active session per domain, 500-idea soft cap, recovery-safe synthesis previews. 6 brainstorm_* tools wired into tool loop.

### File Attachments in Chat (Completed)
Drag-and-drop files from Finder onto the chat panel as LLM context. Split transport/storage: file contents sent in LLM user message with injection-guarded preamble; only metadata (filename, size, SHA-256) persisted in chat history. **Text files** (.md, .ts, .json, .csv, etc. + exact-name files like Dockerfile, Makefile): read via `file.text()`, encoding validated, 100KB limit. **Binary documents** (PDF, Excel, Word): read as `ArrayBuffer`, sent to main process via `file:extract-text` IPC for server-side extraction (`unpdf`, `xlsx`, `mammoth`), 2MB limit. Shared pipeline: deterministic truncation (50K chars/file), hash-based dedup, incremental budget enforcement (500KB / 200K chars / 20 files total), display-name collision handling. UI: `ChatAttachmentsBar` with file chips (name, size, truncation badge, hash tooltip), remove/remove-all, error toast with auto-dismiss. Message bubbles show attachment badges for historical messages.

### Skill Library (Completed)
Reusable analytical procedures stored globally and activated per-message. Full vertical slice: DB migration v16 (`skills` table with COLLATE NOCASE, CHECK constraints, JSON1 validation) → Zod schemas with `.superRefine()` cross-field validation (structured ↔ outputSchema) → Repository with merged-state validation on update → Prompt injection (between shared protocols and domain protocols, with protocol precedence enforcement, 12K char budget) → IPC handlers (9 channels: CRUD + toggle + import/export) → Preload bridge → Zustand store (`activeSkillIdByDomain` for domain-scoped selection, 5-min cache TTL) → UI (SkillSelector chips, SkillEditor form, SkillLibraryDialog with search/filter/toggle/import/export). Import/export uses `.skill.md` format with frontmatter + fenced outputSchema block. Skills support freeform or structured JSON output with schema enforcement, and tool hints for recommending specific tools.

### Mission System (Completed — v1 + v2)
Reusable mission definitions with a 10-step lifecycle runner, approval gates, and full provenance. DB migrations v18–v20: 6 tables (`missions`, `mission_domain_assoc`, `mission_runs`, `mission_run_outputs`, `mission_run_gates`, `mission_run_actions`) + drops audit_log CHECK constraint + v19 Loan Document Review seed + v20 methodology/outputLabels patch. Two seeded missions: Portfolio Briefing and Loan Document Review. **Runner** (`MissionRunner`): framework-agnostic 10-step lifecycle (validate inputs → check permissions → assemble context → build prompt → stream LLM → parse outputs → persist → evaluate gates → execute actions → finalize). All deps injected via `MissionRunnerDeps` (no Electron imports in core). **Generalized dep hooks** (v2): `buildContext` (mission-specific context + provenance snapshot), `buildPrompts` (system + user prompt construction), `shouldGate` (mission-specific gate evaluation with input validation), `buildEmailBody`, `buildEmailSubject`. Fallback: when deps not provided, current portfolio-briefing logic. **Loan Document Review**: CMBS methodology prompt builder (`buildLoanReviewPrompt`), strict fenced-block output parser (`loan_review_memo` + `loan_review_heatmap_json`), `docPaths` parameter for scoped KB loading with per-file provenance, `<doc_inventory>` block in prompt listing reviewed + missing docs. Real Gmail draft creation via shared `createRealGmailDraft()` helper. **Data-driven metadata** (v2): `methodology` and `outputLabels` fields on `MissionDefinition` for self-describing missions (no hardcoded maps). **Gates**: side-effect intent check — deadlines gated if parsed actions > 0, email always gated if valid recipient provided. Gate rejection ≠ cancellation (run succeeds with actions skipped; `cancelled` reserved for user abort). Email validation in `shouldGate` implementation (not runner) — invalid email → gate skipped with warning. **Provenance**: every run stores `definition_hash`, `prompt_hash`, `context_hash`, `model_id`, `provider`, `context_json` (KB digest timestamps, domain list, `systemPromptChars`, `userPromptChars`, `missionType`, `inputsHash`). **Output parser registry**: `Map<missionId, MissionOutputParser>` with `initMissionParsers()` bootstrap; loan review parser extracts fenced memo + heatmap JSON with diagnostics. **Cancel-by-requestId**: `mission:run-cancel-by-request-id` IPC channel for aborting during streaming before `runId` is known. **State transitions**: enforced in `MissionRunRepository` (pending → running → gated → success/failed/cancelled). Single active run per app. **UI**: MissionControlPage with mission selector dropdown, dynamic parameter form (from `definition.parameters` + `parametersOrder`), data-driven capabilities (methodology + output labels), `LoanReviewMemoCard` (markdown memo + heatmap risk table), `WarningsBanner` for run warnings, streaming output with inline stop button, provenance panel, run history. Gate modal (`MissionGateModal`) shows pending actions for approval. Zustand store (`mission-store`) with tab-switch-safe state management, `cancelRun()` prefers requestId-based cancel during streaming. 13 IPC channels + 1 streaming event channel.

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
| `src/brainstorm/technique-library.ts` | 56 brainstorming techniques + 50 elicitation methods across 10 categories with `getById`, `getByCategory`, `recommend` (heuristic), `getRandom`; technique data adapted from BMAD-METHOD (MIT) |
| `src/brainstorm/schemas.ts` | Zod schemas for brainstorm sessions, rounds, ideas, step transitions; `STEP_TRANSITIONS` graph, `PAUSABLE_STEPS`, constants |
| `src/brainstorm/repository.ts` | `BrainstormSessionRepository` — CRUD with step transition graph, idempotent pause/resume, auto-round creation via `getOrCreateOpenRound()`, 500-idea soft cap |
| `src/brainstorm/synthesizer.ts` | Deterministic `synthesize()`: keyword clustering, n-gram labeling, ranked options (up to 10), recommendations, contrarian views, assumptions |
| `src/agents/brainstorm-protocol.ts` | Seeded facilitation protocol (~500 tokens): when to use deep vs. quick brainstorm, anti-bias pivots, energy checkpoints, session lifecycle |
| `src/skills/schemas.ts` | Zod schemas for skill create/update with `.superRefine()` cross-field validation (structured ↔ outputSchema); `SkillOutputFormatSchema`, `CreateSkillInputSchema`, `UpdateSkillInputSchema` |
| `src/skills/repository.ts` | `SkillRepository` — CRUD with merged-state validation on update, COLLATE NOCASE duplicate guard, JSON roundtrip for toolHints, toggleEnabled |
| `src/skills/serialization.ts` | `.skill.md` import/export: `skillToMarkdown()` / `markdownToSkillInput()` with frontmatter + fenced outputSchema block |
| `src/missions/schemas.ts` | Zod schemas + TS types for missions, runs, outputs, gates, actions; `MissionRunStatus`, `MissionOutputType`, `MissionDefinition` (incl. `methodology`, `outputLabels`, `scope`, `parametersOrder`), `MissionContextSnapshot`, `CreateMissionRunInputSchema`, `GateDecisionInputSchema` |
| `src/missions/repository.ts` | `MissionRepository` — mission CRUD, domain association (enable/disable), `listSummaries()`, `listSummariesForDomain()`, canonical definition hashing (SHA-256 with deep-sort), `missionToSummary()` (passes through methodology/outputLabels) |
| `src/missions/run-repository.ts` | `MissionRunRepository` — run lifecycle with enforced state transitions, outputs, gates (with resume validation), actions, `getActiveRun()`, `getRunDetail()` |
| `src/missions/runner.ts` | `MissionRunner` — 10-step lifecycle orchestrator; deps injected via `MissionRunnerDeps` (no Electron imports); optional hooks: `buildContext`, `buildPrompts`, `shouldGate`, `buildEmailBody`, `buildEmailSubject`; `start()`, `resumeAfterGate()`, `cancel()` |
| `src/missions/output-parser.ts` | `MissionOutputParser` interface + registry (`Map<missionId, parser>`); Portfolio Briefing parser wraps `parseBriefingAnalysis()`; Loan Review parser extracts fenced memo + heatmap JSON; `initMissionParsers()` bootstrap |
| `src/loan-review/prompt-builder.ts` | `buildLoanReviewPrompt(ctx, inputs)` — CMBS methodology system prompt with `<doc_inventory>` + `<kb_context>` blocks, review depth modes (triage/attorney-prep/full-review) |
| `src/loan-review/output-parser.ts` | `parseLoanReview(rawText)` — deterministic fence extraction for `loan_review_memo` + `loan_review_heatmap_json` blocks with single-occurrence enforcement and diagnostics |
| `src/loan-review/index.ts` | Barrel export: `LoanReviewContext` type, `buildLoanReviewPrompt`, `parseLoanReview` |
| `src/storage/` | SQLite schema, migrations (v1–v20). v8: per-domain model override. v9: directed relationships. v11: decision quality columns. v12: advisory_artifacts table. v14: brainstorm_sessions table. v16: skills table. v18: missions (6 tables + audit_log CHECK drop + seed data). v19: Loan Document Review mission seed. v20: methodology/outputLabels patch for existing missions |
| `src/common/` | Result type, shared Zod schemas |

### Integrations (`packages/integrations/`)

| File | Purpose |
|------|---------|
| `src/gmail/` | `GmailClient` (search/read/getAttachmentData/createDraft), `GmailPoller`, body parser (`extractTextBody`, `extractAttachmentMeta`), `GmailAttachmentMeta` type |
| `src/gtasks/client.ts` | `GTasksClient` (listTaskLists, search, read, completeTask, updateTask, deleteTask, getOverdue) — on-demand Google Tasks API v1, read-write |

### Chrome Extension (`extensions/chrome-dominos/`)

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — popup, options, content script on `mail.google.com` |
| `gmail-drag.js` | Content script: inject drag handles on Gmail rows, extract subject via 3-strategy heuristic, encode in URL query param for cross-app drag |
| `popup.html` / `popup.js` | "Send to DomainOS" intake UI — extracts page content and sends to localhost intake server |
| `options.html` / `options.js` | Extension settings (auth token, port) |

### Desktop App (`apps/desktop/`)

| File | Purpose |
|------|---------|
| `src/main/ipc-handlers.ts` | 80+ IPC handlers: domains, KB, chat, briefing, intake, protocols, sessions, relationships, gap flags, decisions, audit, advisory, skills, missions, Gmail (incl. `enrichWithAttachments` for email attachment text extraction), GTasks, settings, file text extraction |
| `src/main/text-extractor.ts` | Shared text extraction module: `resolveFormat()` (extension-first + mimeType fallback), `extractTextFromBuffer()` (PDF via `unpdf`, Excel via `xlsx`, Word via `mammoth`), `isFormatSupported()`. Used by both `file:extract-text` IPC and gmail attachment enrichment |
| `src/main/tool-loop.ts` | **Provider-agnostic** tool-use loop — works with Anthropic, OpenAI, Ollama; prefix-based dispatch (`gmail_*`, `gtasks_*`, `advisory_*`), ROWYS Gmail guard, tool output sanitization, transcript validation, size guards (75KB/result, 400KB total), capability cache management |
| `src/main/advisory-tools.ts` | `ADVISORY_TOOLS` as `ToolDefinition[]` (advisory_search_decisions, advisory_search_deadlines, advisory_cross_domain_context, advisory_risk_snapshot), executors with output caps (10 items, 300 char truncation), `schemaVersion` wrapper |
| `src/main/brainstorm-tools.ts` | `BRAINSTORM_TOOLS` as `ToolDefinition[]` (brainstorm_start_session, brainstorm_get_techniques, brainstorm_capture_ideas, brainstorm_session_status, brainstorm_synthesize, brainstorm_session_control), `executeBrainstormTool()` |
| `src/main/gmail-tools.ts` | `GMAIL_TOOLS` as `ToolDefinition[]` (provider-agnostic), input validation, executor |
| `src/main/gmail-oauth.ts` | OAuth PKCE flow via system browser + loopback |
| `src/main/gmail-credentials.ts` | Encrypted credential storage (safeStorage) |
| `src/main/gcp-oauth-config.ts` | Encrypted GCP OAuth client ID/secret storage — shared by Gmail + GTasks OAuth flows |
| `src/main/gtasks-tools.ts` | `GTASKS_TOOLS` as `ToolDefinition[]` (gtasks_search, gtasks_read, gtasks_complete, gtasks_update, gtasks_delete), input validation, executor |
| `src/main/gtasks-oauth.ts` | Google Tasks OAuth PKCE flow — scope `tasks` (read-write), loads credentials from `gcp-oauth-config` |
| `src/main/gtasks-credentials.ts` | Encrypted GTasks credential storage (`gtasks-creds.enc`, safeStorage) |
| `src/main/kb-watcher.ts` | Filesystem monitoring for KB directories — `startKBWatcher()`, `stopKBWatcher()`, debounced (500ms), sends `kb:files-changed` to renderer |
| `src/preload/api.ts` | IPC type contract: `DomainOSAPI`, `ProviderConfig`, `ProviderKeysStatus`, `ToolTestResult`, `PortfolioHealth`, `BriefingAnalysis`, `MissionRunDetailData`, `MissionProgressEventData` |
| `src/renderer/components/SettingsDialog.tsx` | Multi-provider settings modal (API keys, Google OAuth config, Ollama connection, model defaults, tool test) |
| `src/renderer/pages/DomainChatPage.tsx` | Chat page with per-domain model override UI (tri-state: global default / override / clear) |
| `src/renderer/pages/BriefingPage.tsx` | Portfolio health dashboard + LLM analysis streaming UI with alerts, actions, monitors + GTasks connect/disconnect + overdue badge |
| `src/renderer/stores/settings-store.ts` | Zustand store for provider keys (boolean+last4), global config, Ollama state |
| `src/renderer/stores/domain-store.ts` | Zustand store for domains including `modelProvider`, `modelName`, `forceToolAttempt` |
| `src/renderer/stores/advisory-store.ts` | Zustand store for advisory artifacts: fetch, filter (status/type), archive/unarchive, rename |
| `src/renderer/stores/briefing-store.ts` | Zustand store: `fetchHealth()`, `analyze()` with streaming + cancel, snapshot hash stale detection |
| `src/renderer/common/file-attach-utils.ts` | Pure file attachment utilities: validation (`isAllowedFile`, `isBinaryFormat`), SHA-256 hashing, truncation, budget accounting, LLM block assembly, `AttachedFile` type |
| `src/renderer/components/ChatAttachmentsBar.tsx` | File chips UI: displayName + size + truncation badge + hash tooltip, remove/remove-all, error toast with auto-dismiss |
| `src/renderer/components/ChatPanel.tsx` | Chat input with drag-and-drop file/email attachment, Gmail email drop detection (`dominos_subject` URL param + `text/uri-list` fallback), `processFiles()` with budget enforcement, binary file extraction via IPC |
| `src/renderer/components/AdvisoryPanel.tsx` | Strategic History panel — status/type filters, expandable artifact cards, type-specific content renderers, archive/unarchive actions |
| `src/renderer/stores/skill-store.ts` | Zustand store for skills: `activeSkillIdByDomain` (domain-scoped selection), `fetchSkills(force?)` with 5-min cache, auto-clear stale selections |
| `src/renderer/components/SkillSelector.tsx` | Chip-based skill selector above chat textarea; per-message activation with auto-clear after send |
| `src/renderer/components/SkillLibraryDialog.tsx` | Full CRUD dialog: search, filter (all/enabled/disabled), toggle, edit, delete with confirm, import/export |
| `src/renderer/components/SkillEditor.tsx` | Skill form: name, description, content textarea, output format radio, JSON schema (validated on blur), tool hints |
| `src/renderer/pages/MissionControlPage.tsx` | Mission Control page — mission selector dropdown, dynamic parameter form (from definition), data-driven capabilities (methodology + outputLabels), `LoanReviewMemoCard` (markdown memo + heatmap risk table), `WarningsBanner`, streaming output with inline stop, provenance panel, run history |
| `src/renderer/components/MissionGateModal.tsx` | Gate approval dialog — shows pending actions (deadlines, email drafts) for user approval/rejection |
| `src/renderer/stores/mission-store.ts` | Zustand store for missions: `startRun()` with streaming progress, `cancelRun()` (prefers requestId-based cancel), `decideGate()`, `checkActiveRun()` for tab-switch recovery, `clearRun()` |

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

Database columns (migration v8): `model_provider TEXT`, `model_name TEXT`, `force_tool_attempt INTEGER` (latest migration: v20 — mission methodology/outputLabels)
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
| `file:extract-text` | renderer→main | Binary file text extraction (PDF via `unpdf`, Excel via `xlsx`, Word via `mammoth`) |
| `skill:list` | renderer→main | List all skills (for library management) |
| `skill:list-enabled` | renderer→main | List enabled skills (for selector UI) |
| `skill:get` | renderer→main | Get skill by ID |
| `skill:create` | renderer→main | Create a new skill |
| `skill:update` | renderer→main | Update skill fields |
| `skill:delete` | renderer→main | Delete a skill |
| `skill:toggle` | renderer→main | Toggle skill enabled/disabled |
| `skill:export` | renderer→main | Export skill as `.skill.md` file (save dialog) |
| `skill:import` | renderer→main | Import skill from `.skill.md` file (open dialog) |
| `mission:list` | renderer→main | List all enabled missions (global) |
| `mission:list-for-domain` | renderer→main | List missions enabled for a domain |
| `mission:get` | renderer→main | Get mission by ID |
| `mission:enable-for-domain` | renderer→main | Enable a mission for a domain |
| `mission:disable-for-domain` | renderer→main | Disable a mission for a domain |
| `mission:run` | renderer→main | Start a mission run (streams progress via `mission:run-progress`) |
| `mission:run-cancel` | renderer→main | Cancel active run by runId |
| `mission:run-cancel-by-request-id` | renderer→main | Cancel active run by requestId (works during streaming before runId available) |
| `mission:run-status` | renderer→main | Get run detail (run + outputs + gates + actions) |
| `mission:gate-decide` | renderer→main | Approve/reject a pending gate |
| `mission:run-history` | renderer→main | List past runs for a domain |
| `mission:active-run` | renderer→main | Get any non-terminal run (for state recovery on remount) |
| `mission:latest-run` | renderer→main | Get latest completed run for a domain (for switchDomain restore) |
| `mission:run-progress` | main→renderer | Streaming events: `llm_chunk`, `gate_triggered`, `run_complete`, `run_failed` |

## Google OAuth Configuration

Gmail and Google Tasks integration requires GCP OAuth credentials (Client ID + Secret from a Desktop/Native app OAuth client with `gmail.readonly`, `gmail.compose`, and `tasks` scopes).

**Users configure these in Settings → API Keys → Google OAuth.** Credentials are encrypted via `safeStorage` (OS keychain) and stored as `gcp-oauth-config.enc` in the app's `userData` directory. They are never baked into the build.

Without configured OAuth credentials, Gmail/GTasks "Connect" shows a clear error directing users to Settings; all other features work normally.

**Key files:**
| File | Purpose |
|------|---------|
| `apps/desktop/src/main/gcp-oauth-config.ts` | Encrypted save/load/clear for GCP OAuth config |
| `apps/desktop/src/main/gmail-oauth.ts` | Gmail OAuth flow — loads credentials from `gcp-oauth-config` at runtime |
| `apps/desktop/src/main/gtasks-oauth.ts` | GTasks OAuth flow — loads credentials from `gcp-oauth-config` at runtime |

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
