## Local-First AI Agent Desktop (Pre-Release)

DomainOS is a **local-first AI agent desktop app** for managing multiple professional domains with **domain-scoped assistants**, a **persistent knowledge base**, and **bring-your-own-key (BYOK)** privacy. Run with hosted providers or fully local models, with per-domain model selection.

### Highlights

- **Domain-scoped AI agents** — isolate context, instructions, and KB per domain
- **Multi-provider LLM support** — hosted and local models with per-domain override
- **KB management** — scan, sync, and browse domain knowledge base files with tiered importance
- **Tool integration** — optional provider-agnostic tool loop with capability detection and safe fallbacks
- **Cross-domain relationships** — directed dependencies (blocks, depends_on, informs, parallel, monitor_only) powering portfolio-wide alerts
- **Portfolio health briefing** — computed health scoring with LLM-powered analysis streaming
- **Browser ingestion pipeline** — Chrome extension captures web content, AI classifies it into the right domain
- **Privacy posture** — local-first architecture, encrypted API key storage, no telemetry

### Architecture

```
Renderer (React) → IPC → Main Process (Node) → @domain-os/core → SQLite + Filesystem
```

- Domain config resolves the effective model (domain override or global default)
- Provider factory instantiates the correct adapter (hosted or local)
- Chat handler routes between streaming path and tool loop (capability-gated)
- KB scanner syncs filesystem state to local indexed cache

### Why DomainOS?

If you work across multiple areas — projects, clients, properties, investments — DomainOS helps you:

- **Keep context separated** per domain with dedicated AI assistants
- **Maintain durable, searchable knowledge bases** that persist across sessions
- **Switch models and providers per domain** without re-wiring the app
- **Keep sensitive material local** with encrypted key storage and no cloud sync
- **See portfolio-wide health** with cross-domain dependency tracking and alerts

### Screenshot

![DomainOS screenshot](docs/screenshot.png)

### Notes

This is an alpha pre-release. Expect rough edges and breaking changes while the core architecture stabilizes. Contributions welcome — see the issue templates for bug reports, feature requests, and questions.
