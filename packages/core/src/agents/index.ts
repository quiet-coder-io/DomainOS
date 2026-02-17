/**
 * Agents — LLM-powered assistants scoped to domains.
 * Handles prompt construction, API calls (BYOK), and response processing.
 */

export type { ChatMessage, LLMProvider } from './provider.js'
export { AnthropicProvider } from './anthropic-provider.js'
export type { AnthropicProviderOptions } from './anthropic-provider.js'
export { buildSystemPrompt } from './prompt-builder.js'
export type { PromptDomain, PromptKBContext, PromptProtocol } from './prompt-builder.js'
export { parseKBUpdates } from './kb-update-parser.js'
export type { KBUpdateProposal } from './kb-update-parser.js'
