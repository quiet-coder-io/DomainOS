# Contributing to DomainOS

Thanks for your interest in DomainOS — the local-first, privacy-respecting AI knowledge management system. Whether you're fixing a typo, improving docs, or building a new feature, contributions are welcome.

## Getting Started

See the [Quick Start](README.md#quick-start) section in the README for setup instructions. Prerequisites: **Node.js >= 22** and **npm**.

## Good First Contributions

Look for issues tagged with these labels:

- **`good-first-issue`** — small, well-scoped tasks ideal for new contributors
- **`documentation`** — docs improvements, examples, and guides
- **`refactor`** — code cleanup and structural improvements
- **`help-wanted`** — features or fixes where maintainer guidance is available

Don't see an issue for your idea? Open one first to discuss the approach before writing code.

## Development Philosophy

1. **Local-first** — data stays on the user's machine. No telemetry, no cloud dependencies.
2. **Core stays framework-agnostic** — `@domain-os/core` has zero React or Electron dependencies. All UI concerns live in `apps/desktop/`.
3. **Explicit over implicit** — use `Result<T, E>` for fallible operations, Zod for validation, strict TypeScript everywhere.
4. **Small surface, big leverage** — avoid abstractions until you need them. Three similar lines beat a premature helper.

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
- Core is imported by desktop, never the other way around.

## LLM Provider Development

When working on provider-related code:

- **Provider interface** is defined in `packages/core/src/agents/provider.ts` — this is the authoritative contract
- All providers implement `ToolCapableProvider` which extends `LLMProvider` with `createToolUseMessage()`
- Tool definitions use `ToolDefinition` (provider-agnostic), not Anthropic or OpenAI native types
- `rawAssistantMessage` is an opaque blob — never reconstruct from text content
- Tool-use rounds are always non-streaming (`stream: false`)
- Ollama extends OpenAI provider via OpenAI-compatible API at `${base}/v1`
- The tool-loop in `apps/desktop/src/main/tool-loop.ts` is provider-agnostic — never add provider-specific logic there

## PR Workflow

1. **Fork and branch** — create a feature branch from `main`.
2. **Keep PRs focused** — one logical change per PR. Smaller PRs get faster reviews.
3. **Write a clear description** — explain *what* changed and *why*.
4. **Pass CI** — ensure `npm run typecheck` and `npm test` pass before requesting review.

## Privacy Expectations

DomainOS is a privacy-first project. All contributions must respect this:

- **No secrets in code** — never commit API keys, tokens, or credentials. Use environment variables or the OS keychain.
- **No `.env` files** — `.env` is gitignored. Never include it in PRs.
- **No logs with file paths** — avoid logging absolute filesystem paths that could reveal user directory structure.
- **Redact screenshots** — if your PR includes screenshots, redact any personal data, file paths, or domain names.

## PR Checklist

Before submitting your PR, verify:

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` passes
- [ ] No secrets, credentials, or `.env` files included
- [ ] PR description clearly explains the change and motivation
- [ ] Changes align with the [privacy expectations](#privacy-expectations) above

## License

By contributing to DomainOS, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
