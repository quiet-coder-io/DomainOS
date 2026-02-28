# DomainOS Roadmap

> **Last updated:** February 2026

This roadmap reflects current priorities and may shift as the project evolves. Items are grouped by theme, not strict timeline. Contributions welcome on any item — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Completed

### Core Platform
- [x] Domain-scoped AI assistants with persistent knowledge bases
- [x] KB file indexing with tiered importance and digest generation
- [x] AI-proposed KB updates with user review and approval
- [x] Composable protocols (per-domain and shared, with priority ordering)
- [x] KB file watching with debounced auto-scan

### Multi-Provider LLM
- [x] Anthropic (Claude), OpenAI (GPT-4o, o3-mini), Ollama (local models)
- [x] Per-domain model selection with global default override
- [x] Provider-agnostic tool-use loop with capability caching
- [x] Graceful fallback when models don't support tool calls
- [x] Encrypted API key storage via OS keychain

### Safety & Governance
- [x] Stop blocks (escalation triggers with red alerts)
- [x] Gap flag detection and acknowledge/resolve workflow
- [x] Decision logging with rationale, downsides, revisit triggers
- [x] Decision quality gates (confidence, horizon, reversibility, category, authority tier)
- [x] Full audit trail per domain

### Strategic Advisory System
- [x] Mode-classified responses (brainstorm, challenge, review, scenario, general)
- [x] Advisory artifacts with schema-validated JSON fence blocks
- [x] Strict parser with Zod validation, fingerprint dedup, layered rate limiting
- [x] Strategic History panel with status/type filters and archive workflow
- [x] 4 read-only advisory tools (search decisions, search deadlines, cross-domain context, risk snapshot)
- [x] Deterministic task extraction from artifacts ("Turn into tasks")
- [x] Cross-domain contamination guard in tool outputs

### Portfolio Health
- [x] Computed health scoring (KB staleness, gap flags, dependencies)
- [x] Cross-domain alerts for stale/blocked domains
- [x] LLM-powered analysis with streaming (alerts, actions, monitors)
- [x] Deadline management with priority and status tracking
- [x] Snapshot hashing for stale detection

### Automations & Triggers
- [x] Domain-scoped automation rules (trigger → AI prompt → action)
- [x] Schedule triggers (5-field cron), event triggers (intake/KB/gap flag/deadline), manual triggers
- [x] Action types: in-app notification, create Google Task, draft Gmail
- [x] Atomic dedupe via UNIQUE partial index (prevents double-fires)
- [x] Failure tracking with auto-disable at 5 consecutive failures
- [x] Rate limiting (per-automation, per-domain, global) with in-memory rolling windows
- [x] Privacy controls (opt-in payload storage, SHA-256 hashes by default)
- [x] Crash recovery and retention cleanup
- [x] Starter templates for common automation patterns

### Strategic Brainstorming (BMAD Method)
- [x] Deep facilitated brainstorming sessions with AI as facilitator (not generator)
- [x] 106 techniques (56 brainstorming + 50 elicitation) across 10 categories, adapted from [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- [x] Heuristic technique recommendations (keyword matching + category affinity, no LLM)
- [x] Multi-round idea capture with automatic round management and technique switching
- [x] Deterministic synthesis: keyword clustering, n-gram labeling, ranked options (no LLM)
- [x] Anti-bias facilitation protocol (creative pivots, energy checkpoints, push past obvious ideas)
- [x] Session lifecycle: start → techniques → facilitate → pause/resume → synthesize → artifact
- [x] One active session per domain, 500-idea soft cap, recovery-safe synthesis previews

### Mission System
- [x] Mission definitions with 10-step lifecycle runner (validate → context → prompt → LLM → parse → persist → gate → actions → audit → finalize)
- [x] Portfolio Briefing as first seeded mission
- [x] Approval gates for side effects (deadlines, email drafts)
- [x] Per-run provenance (definition hash, prompt hash, model, KB digest timestamps, context hash)
- [x] Generalized runner with optional dep hooks (`buildContext`, `buildPrompts`, `shouldGate`, `buildEmailBody`, `buildEmailSubject`)
- [x] Loan Document Review mission — CMBS methodology, fenced-block output parser (attorney memo + risk heatmap JSON), doc-path scoping with per-file provenance
- [x] Data-driven mission metadata (`methodology`, `outputLabels`) for self-describing missions
- [x] Dynamic parameter form rendered from mission definition (`parameters` + `parametersOrder`)
- [x] Mission selector UI for switching between enabled missions
- [x] Cancel-by-requestId for aborting missions during streaming (before runId is available)
- [x] Real Gmail draft creation via gate-approved actions

### Integrations
- [x] Gmail read-only tools (search, read) via OAuth PKCE
- [x] Gmail draft creation (real Gmail API drafts via mission gate actions)
- [x] Google Tasks read-write tools (search, read, complete, update, delete)
- [x] Google Tasks inline editing in portfolio briefing
- [x] Browser-to-app intake pipeline (Chrome extension)
- [x] Gmail email drag-and-drop into chat (Chrome extension content script with drag handles, subject-in-URL encoding for cross-app transfer)
- [x] Cross-domain directed relationships (blocks, depends_on, informs, parallel, monitor_only)

### Plugin System
- [x] Install plugins from Anthropic's knowledge-work-plugins (11 plugins) and financial-services-plugins (7 plugins)
- [x] Atomic installer with extraction safety (path traversal, symlinks, size/count limits, file type allowlist)
- [x] Trust & provenance — source allowlist, commit SHA, per-file content hashes, manifest integrity checks
- [x] Plugin skills automatically appear in skill selector for immediate use in chat
- [x] Plugin commands with dual slug namespacing (canonical for persistence, display for UX)
- [x] Source-aware hard dependency enforcement at domain-enable and command invocation time
- [x] Three-way content model (original/customized/updated) with modification detection and diff dialog
- [x] Marketplace browser with ETag caching, rate-limit resilience, and offline fallback
- [x] Plugin detail panel: skills, commands, version, author, source, license, install path
- [x] Per-domain plugin association with lazy row creation

### Knowledge Base Vector Search (RAG)
- [x] Semantic search over domain KBs via local Ollama embeddings or OpenAI (explicit opt-in)
- [x] Heading-aware markdown chunking with stable content-anchored identity
- [x] MMR diversity retrieval with anchor heading boost
- [x] Structural reserve for domain identity chunks
- [x] Automatic indexing on domain switch / KB file changes
- [x] In-memory embedding cache with 15-min TTL
- [x] Graceful fallback to tier-based KB context

### File Attachments & Email Extraction
- [x] Drag-and-drop files from Finder into chat (text files up to 100KB, binary docs up to 2MB)
- [x] Automatic text extraction from PDF, Excel, Word attachments in Gmail emails
- [x] Budget enforcement (500KB total, 200K chars, 20 files, hash-based dedup)
- [x] Privacy-first storage (contents sent inline, only metadata persisted)

### Skill Library
- [x] Reusable analytical procedures with per-message activation and domain-scoped selection
- [x] Freeform or structured JSON output with schema enforcement and tool hints
- [x] Import/export as `.skill.md` files with frontmatter + fenced outputSchema
- [x] Full CRUD management dialog with search, filter, toggle, inline editing

### UI & Experience
- [x] Collapsible UI panels — header bar, left sidebar, right KB sidebar with localStorage persistence
- [x] Toggle-all-panels button in window titlebar
- [x] Smart prompt context window — token-aware history slicing, conversation summaries, recall intent detection
- [x] Response style setting (concise/detailed) injected into system prompt
- [x] Dark/light theme toggle

### Platform
- [x] Auto-update mechanism — checks GitHub Releases on launch + every 4 hours, hardened manual installer for unsigned macOS apps

---

## Next Up

### Mission Builder
- [ ] User-created missions via template system (configure skills, protocols, tools — similar to Claude Code plugins)
- [ ] Mission import/export as `.mission.md` or JSON
- [ ] Custom output parsers defined via schema (no code required)
- [ ] Mission marketplace / sharing

### Advisory System Enhancements
- [ ] Extended advisory protocols (Strategic Advisor, Interaction Modes, Email Response Advisor) as seedable shared protocols
- [ ] Advisory write tool for manual artifact creation and import
- [ ] Negotiation mode (structured negotiation strategy analysis)
- [ ] Bulk artifact import with validation (`source: 'import'`)
- [ ] Advisory artifact export (JSON, PDF)

### Automation Enhancements
- [ ] KB-aware prompts — inject KB digest/snippets into automation prompt context so the LLM has domain knowledge, not just the domain name
- [ ] Email trigger — poll Gmail for new messages matching sender/subject filters, fire automations on match
- [ ] Classify-to-domain action — route incoming content (email, intake) to a specific domain based on AI classification
- [ ] Workflow chains — multi-step automations: trigger → prompt → action → prompt → action (currently limited to one prompt → one action)
- [ ] Webhook trigger — fire automations from external HTTP requests (beyond Chrome extension intake)
- [ ] Conditional actions — branch on LLM response content (e.g., create task only if response contains action items)

### Plugin System — Phase 2
- [ ] MCP adapter — thin HTTP adapter for plugin connectors, per-connector `auth_type` tracking, disabled by default
- [ ] Command autocomplete in chat — popover on `/` with display_slug, plugin subtitle, argument hint
- [ ] Plugin update with three-way diff dialog for customized skills/commands
- [ ] Plugin integrity check on startup (manifest hash verification, auto-disable corrupted plugins)
- [ ] Command diagnostics panel in PluginDetailPanel

### Account Mapping Tool
- [ ] Visual mapping of domain accounts, entities, and relationships
- [ ] Interactive graph view of cross-domain dependencies

### User Experience
- [ ] Onboarding wizard improvements
- [ ] Keyboard shortcuts for common actions
- [ ] Search across all domains (global search)

### Platform
- [ ] Protocol marketplace / sharing
- [ ] Windows and Linux builds
- [ ] Performance profiling and optimization for large KBs

---

## Future Considerations

These are ideas under consideration, not commitments:

- **Calendar integration** — connect to Google Calendar or Outlook for deadline/event awareness
- **Document generation** — export domain knowledge as structured reports or memos
- **Collaborative domains** — shared domain access across multiple users (requires auth layer)
- **Full MCP client** — SSE transport, OAuth flows, connection health monitoring for plugin connectors
- **Mobile companion** — lightweight read-only view of domain state
- **Webhook intake** — programmatic ingestion beyond the Chrome extension
- **Three-way merge** — intelligent merge for customized skill/command updates (beyond current keep/overwrite)

---

## How to Contribute

Pick any item above and open an issue to discuss your approach before starting. Items labeled [`good-first-issue`](https://github.com/quiet-coder-io/DomainOS/labels/good-first-issue) are a great starting point.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and development guidelines.
