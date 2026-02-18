/**
 * Agents — LLM-powered assistants scoped to domains.
 * Handles prompt construction, API calls (BYOK), and response processing.
 */

export type { ChatMessage, LLMProvider } from './provider.js'
export { AnthropicProvider } from './anthropic-provider.js'
export type { AnthropicProviderOptions } from './anthropic-provider.js'
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
