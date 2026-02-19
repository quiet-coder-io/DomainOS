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

- `packages/core/` — framework-agnostic core library (no React, no Electron). Includes LLM providers (Anthropic, OpenAI, Ollama), domain management, KB indexing, protocols, and storage.
- `packages/integrations/` — external service integrations (Gmail client, poller, body parser)
- `apps/desktop/` — Electron + React desktop application. Main process handles IPC, tool-use loop, and credential storage. Renderer is React 19 + Tailwind CSS 4.
- Core is imported by desktop, never the other way around

## LLM Provider Development

When working on provider-related code:

- **Provider interface** is defined in `packages/core/src/agents/provider.ts` — this is the authoritative contract
- All providers implement `ToolCapableProvider` which extends `LLMProvider` with `createToolUseMessage()`
- Tool definitions use `ToolDefinition` (provider-agnostic), not Anthropic or OpenAI native types
- `rawAssistantMessage` is an opaque blob — never reconstruct from text content
- Tool-use rounds are always non-streaming (`stream: false`)
- Ollama extends OpenAI provider via OpenAI-compatible API at `${base}/v1`
- The tool-loop in `apps/desktop/src/main/tool-loop.ts` is provider-agnostic — never add provider-specific logic there

## PR Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run typecheck` and `npm test` pass
4. Open a PR with a clear description of what and why
5. One approval required to merge
