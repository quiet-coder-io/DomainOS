/**
 * Agents — LLM-powered assistants scoped to domains.
 * Handles prompt construction, API calls (BYOK), and response processing.
 */

// Provider types and interfaces
export type { ChatMessage, LLMProvider, ToolCapableProvider, ToolUseMessage, ToolUseResponse, ToolDefinition, ToolCall, ToolCapability } from './provider.js'
export { ToolsNotSupportedError, isToolCapableProvider, toolCapKey, getToolCapability, setToolCapability, shouldUseTools, maybeWrapToolsNotSupported, toolCapabilityCache, notObservedCounters } from './provider.js'

// Provider implementations
export { AnthropicProvider } from './anthropic-provider.js'
export type { AnthropicProviderOptions } from './anthropic-provider.js'
export { OpenAIProvider } from './openai-provider.js'
export type { OpenAIProviderOptions } from './openai-provider.js'
export { OllamaProvider, normalizeOllamaUrl } from './ollama-provider.js'
export type { OllamaProviderOptions } from './ollama-provider.js'

// Provider factory
export { createProvider, KNOWN_MODELS, DEFAULT_MODELS } from './provider-factory.js'
export type { ProviderName, ProviderConfig } from './provider-factory.js'

// Prompt builder
export { buildSystemPrompt } from './prompt-builder.js'
export type {
  PromptDomain,
  PromptKBContext,
  PromptKBFile,
  PromptProtocol,
  PromptSiblingContext,
  PromptSessionContext,
  PromptContext,
  PromptResult,
  PromptManifest,
  PromptManifestSection,
  PromptManifestFile,
  PromptManifestExcludedFile,
} from './prompt-builder.js'

// Parsers
export { parseKBUpdates, parseKBUpdatesCompat, REJECTION_REASONS } from './kb-update-parser.js'
export type { KBUpdateProposal, KBUpdateMode, KBUpdateBasis, RejectedProposal, ParseKBUpdatesResult } from './kb-update-parser.js'
export { parseDecisions } from './decision-parser.js'
export type { ParsedDecision } from './decision-parser.js'
export { parseGapFlags } from './gap-parser.js'
export type { ParsedGapFlag } from './gap-parser.js'
export { GapFlagRepository } from './gap-flag-repository.js'
export type { GapFlag, CreateGapFlagInput } from './gap-flag-repository.js'
export { parseStopBlocks } from './stop-parser.js'
export type { ParsedStop } from './stop-parser.js'
export { STOP_PROTOCOL_NAME, STOP_PROTOCOL_CONTENT } from './stop-protocol.js'
export { GAP_DETECTION_PROTOCOL_NAME, GAP_DETECTION_PROTOCOL_CONTENT } from './gap-detection-protocol.js'
export { seedDefaultProtocols } from './seed-defaults.js'
export { estimateTokens, TOKEN_BUDGETS } from './token-budgets.js'
export { detectStatusIntent } from './status-intent.js'
