# DomainOS

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/data-local--first-green.svg)](#security)
[![BYOK](https://img.shields.io/badge/AI-bring--your--own--key-orange.svg)](#security)
[![Open Source](https://img.shields.io/badge/open-source-brightgreen.svg)](LICENSE)

**A local-first desktop app for managing multiple professional domains with AI assistance.**

---

## The Problem

Professionals who manage multiple areas of responsibility (real estate portfolios, businesses, investment accounts, etc.) face a recurring challenge: each domain has its own knowledge base, contacts, deadlines, and decision patterns — but no single tool brings them together without shipping your data to someone else's cloud.

## The Solution

DomainOS is a desktop application that keeps all your data on your machine while giving each domain its own AI-powered assistant. Your documents stay in your filesystem. Your database stays in SQLite. Your API keys stay in your OS keychain.

## Features

- **Domain-scoped AI assistants** — each domain gets its own context, knowledge base, and protocols
- **Knowledge base management** — structured document storage with digests and change tracking
- **Composable protocols** — reusable instruction sets that define how your AI assistant behaves
- **Local-first architecture** — SQLite + filesystem, no cloud dependency
- **Bring Your Own Key** — use your own API keys, stored in your OS keychain
- **Cross-domain awareness** — surface connections between domains without mixing contexts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron |
| UI framework | React 19 |
| Styling | Tailwind CSS 4 |
| Build system | electron-vite (Vite-based) |
| Core library | TypeScript, framework-agnostic |
| Database | SQLite (better-sqlite3) |
| Validation | Zod |
| Package management | npm workspaces |

## Quick Start

```bash
# Clone and install
git clone <repo-url> domain-os
cd domain-os
npm install

# Run in development
npm run dev

# Type-check all packages
npm run typecheck

# Run tests
npm test
```

## Project Structure

```
domain-os/
├── packages/
│   └── core/              # Framework-agnostic core library
│       └── src/
│           ├── domains/   # Domain management
│           ├── kb/        # Knowledge base
│           ├── protocols/ # Reusable instruction sets
│           ├── agents/    # LLM integration (BYOK)
│           ├── storage/   # SQLite + filesystem
│           └── common/    # Shared types and utilities
├── apps/
│   └── desktop/           # Electron + React desktop app
│       └── src/
│           ├── main/      # Electron main process
│           ├── preload/   # Preload scripts (IPC bridge)
│           └── renderer/  # React UI
└── docs/                  # Documentation
```

## License

MIT
