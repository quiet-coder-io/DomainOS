# Contributing to DomainOS

## Setup

```bash
# Prerequisites: Node.js >= 22
node --version

# Install dependencies
npm install

# Verify everything works
npm run typecheck
npm test
```

## Development Workflow

```bash
# Start the desktop app in dev mode
npm run dev

# Run tests in watch mode
cd packages/core && npm run test:watch

# Type-check all packages
npm run typecheck

# Build everything
npm run build
```

## Code Standards

- **ESM only** — all packages use `"type": "module"`
- **Strict TypeScript** — `strict: true`, `verbatimModuleSyntax: true`
- **Barrel exports** — each module has an `index.ts` that re-exports its public API
- **Zod schemas** — all external data is validated with Zod
- **Result pattern** — fallible operations return `Result<T, E>` instead of throwing

## Project Structure

- `packages/core/` — framework-agnostic core library (no React, no Electron)
- `apps/desktop/` — Electron + React desktop application
- Core is imported by desktop, never the other way around

## PR Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run typecheck` and `npm test` pass
4. Open a PR with a clear description of what and why
5. One approval required to merge
