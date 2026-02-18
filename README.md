# DomainOS

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/data-local--first-green.svg)](#security--privacy)
[![BYOK](https://img.shields.io/badge/AI-bring--your--own--key-orange.svg)](#security--privacy)
[![Open Source](https://img.shields.io/badge/open-source-brightgreen.svg)](LICENSE)

**A local-first desktop app for managing multiple professional domains with AI assistance.**

---

## The Problem

Professionals who manage multiple areas of responsibility (real estate portfolios, businesses, investment accounts, etc.) face a recurring challenge: each domain has its own knowledge base, contacts, deadlines, and decision patterns — but no single tool brings them together without shipping your data to someone else's cloud.

## The Solution

DomainOS is a desktop application that keeps all your data on your machine while giving each domain its own AI-powered assistant. Your documents stay in your filesystem. Your database stays in SQLite. Your API keys stay in your OS keychain.

## Features

### Core

- **Domain-scoped AI assistants** — each domain gets its own context, knowledge base, and behavioral protocols
- **Knowledge base management** — point a domain at a folder, auto-index files with tiered importance, generate digests, and track changes over time
- **AI-proposed KB updates** — the assistant analyzes conversations and proposes edits to your knowledge base files, which you review and approve
- **Composable protocols** — per-domain and shared instruction sets that define how your AI assistant behaves, with priority ordering and scope control

### Safety & Governance

- **Stop blocks** — the AI escalates to you with a red alert when it encounters situations requiring human judgment, based on configurable escalation triggers
- **Gap flag detection** — automatically identifies and surfaces knowledge gaps in your KB, with acknowledge/resolve workflow
- **Decision logging** — tracks AI decisions with rationale, downsides, revisit triggers, and linked files; reject decisions you disagree with
- **Audit trail** — full event log of KB changes, session activity, and agent actions per domain
- **Session tracking** — monitor active AI sessions with scope, model, and elapsed time

### Cross-Domain

- **Sibling domain relationships** — link related domains so the AI can surface cross-domain context without mixing knowledge bases
- **Browser-to-app intake pipeline** — Chrome extension with "Send to DomainOS" that extracts web content and routes it to the right domain via AI classification

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Tailwind CSS 4)                   │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐ │
│  │ Chat     │ │ Sidebar  │ │ Intake    │ │ Domain    │ │
│  │ Panel    │ │ Panels   │ │ Panel     │ │ Settings  │ │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘ │
├─────────────────────── IPC ─────────────────────────────┤
│  Main Process (Node.js)                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  @domain-os/core                                 │   │
│  │  ┌────────┐ ┌────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │Domains │ │ KB │ │Protocols │ │  Agents    │  │   │
│  │  ├────────┤ ├────┤ ├──────────┤ ├────────────┤  │   │
│  │  │Sessions│ │Aud │ │Gap Flags │ │ Decisions  │  │   │
│  │  └────────┘ └────┘ └──────────┘ └────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│  SQLite │ Filesystem │ OS Keychain │ Intake Server      │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron |
| UI framework | React 19 |
| Styling | Tailwind CSS 4 |
| State management | Zustand |
| Build system | electron-vite (Vite-based) |
| Core library | TypeScript, framework-agnostic |
| Database | SQLite (better-sqlite3) |
| Validation | Zod |
| Package management | npm workspaces |

## Quick Start

```bash
# Clone and install
git clone https://github.com/quiet-coder-io/DomainOS.git
cd DomainOS
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w better-sqlite3

# Run in development
npm run dev

# Type-check all packages
npm run typecheck

# Run tests
npm test

# Production build
npm run build
```

## Project Structure

```
domain-os/
├── packages/
│   ├── core/                 # Framework-agnostic core library
│   │   └── src/
│   │       ├── domains/      # Domain CRUD and config
│   │       ├── kb/           # KB indexing, digests, tiering
│   │       ├── protocols/    # Per-domain and shared protocols
│   │       ├── agents/       # LLM integration, prompt builder
│   │       ├── sessions/     # Session lifecycle management
│   │       ├── audit/        # Event audit trail
│   │       ├── intake/       # Browser intake classification
│   │       ├── storage/      # SQLite schema and migrations
│   │       └── common/       # Result type, shared schemas
│   └── integrations/         # External service integrations
├── apps/
│   └── desktop/              # Electron + React desktop app
│       └── src/
│           ├── main/         # Main process, IPC handlers, intake server
│           ├── preload/      # contextBridge API surface
│           └── renderer/     # React UI
│               ├── components/  # Shared UI components
│               ├── pages/       # Route-level pages
│               └── stores/      # Zustand state management
└── extension/                # Chrome extension (intake pipeline)
```

## Security & Privacy

- **Local-first** — all data stored on your machine in SQLite and your filesystem. Nothing leaves your computer unless you send a chat message to the LLM API.
- **Bring Your Own Key** — API keys are stored in your OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service), never in plaintext.
- **No telemetry** — zero analytics, tracking, or phone-home behavior.
- **Localhost intake** — the Chrome extension communicates with the desktop app over `127.0.0.1` with token authentication. No external servers.

## License

MIT
