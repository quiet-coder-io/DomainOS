/**
 * Token budget constants and estimation for prompt construction.
 * All budget enforcement uses estimateTokens() — no raw char-based checks.
 *
 * Prompt profiles define per-provider budget strategies:
 * - cloud_full: uncapped, all sections enabled
 * - ollama_fast: hard 3K token ceiling for <2s first-token latency
 * - ollama_balanced: 6K token ceiling for richer context at 3-5s latency
 */

/** Convert character count to estimated token count (1 token ≈ 4 chars). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Clamp a value between min and max (inclusive). */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Estimate total tokens for a chat message history including per-message role overhead. */
export function estimateChatTokens(messages: Array<{ role: string; content: string }>): number {
  const ROLE_OVERHEAD = 4 // role label + message wrapper + separators per message
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content.length) + ROLE_OVERHEAD, 0,
  )
}

// --- Prompt Profile types ---

export type PromptProfileName = 'cloud_full' | 'ollama_fast' | 'ollama_balanced'

export type KBStrategy = 'full' | 'digest_only' | 'digest_plus_structural'

export interface PromptProfileSections {
  identity: boolean
  responseStyle: boolean
  domain: boolean
  tags: boolean
  kb: boolean
  siblings: boolean
  sharedProtocols: boolean
  skill: boolean
  command: boolean
  domainProtocols: boolean | 'micro'
  escalation: boolean
  statusBriefing: boolean | 'capsule'
  session: boolean
  conversationSummary: boolean
  kbInstructions: boolean
  brainstorm: boolean
  advisory: boolean | 'micro'
}

export interface StatusCapsuleLimits {
  overdueMax: number
  gapsMax: number
  actionsMax: number
}

export interface PromptProfile {
  name: PromptProfileName
  modelContextLimit: number
  outputReserve: number
  safetyFactor: number
  maxSystemBudget: number
  minSystemBudget: number
  kbStrategy: KBStrategy
  sections: PromptProfileSections
  statusCapsuleLimits?: StatusCapsuleLimits
  tagsCap?: number
}

// --- Profile definitions ---

const CLOUD_FULL: PromptProfile = {
  name: 'cloud_full',
  modelContextLimit: 128_000,
  outputReserve: 4_096,
  safetyFactor: 1.0,
  maxSystemBudget: 128_000,
  minSystemBudget: 500,
  kbStrategy: 'full',
  sections: {
    identity: true,
    responseStyle: true,
    domain: true,
    tags: true,
    kb: true,
    siblings: true,
    sharedProtocols: true,
    skill: true,
    command: true,
    domainProtocols: true,
    escalation: true,
    statusBriefing: true,
    session: true,
    conversationSummary: true,
    kbInstructions: true,
    brainstorm: true,
    advisory: true,
  },
}

const OLLAMA_FAST: PromptProfile = {
  name: 'ollama_fast',
  modelContextLimit: 32_000,
  outputReserve: 700,
  safetyFactor: 1.15,
  maxSystemBudget: 3_000,
  minSystemBudget: 500,
  kbStrategy: 'digest_only',
  sections: {
    identity: true,
    responseStyle: true,
    domain: true,
    tags: true,
    kb: true,
    siblings: false,
    sharedProtocols: false,
    skill: false,
    command: false,
    domainProtocols: false,
    escalation: true,
    statusBriefing: 'capsule',
    session: false,
    conversationSummary: false,
    kbInstructions: false,
    brainstorm: false,
    advisory: 'micro',
  },
  tagsCap: 5,
  statusCapsuleLimits: { overdueMax: 5, gapsMax: 5, actionsMax: 3 },
}

const OLLAMA_BALANCED: PromptProfile = {
  name: 'ollama_balanced',
  modelContextLimit: 32_000,
  outputReserve: 1_000,
  safetyFactor: 1.15,
  maxSystemBudget: 6_000,
  minSystemBudget: 500,
  kbStrategy: 'digest_plus_structural',
  sections: {
    identity: true,
    responseStyle: true,
    domain: true,
    tags: true,
    kb: true,
    siblings: false,
    sharedProtocols: false,
    skill: false,
    command: false,
    domainProtocols: 'micro',
    escalation: true,
    statusBriefing: 'capsule',
    session: false,
    conversationSummary: false,
    kbInstructions: false,
    brainstorm: false,
    advisory: 'micro',
  },
  tagsCap: 10,
  statusCapsuleLimits: { overdueMax: 6, gapsMax: 6, actionsMax: 5 },
}

export const PROMPT_PROFILES: Record<PromptProfileName, PromptProfile> = {
  cloud_full: CLOUD_FULL,
  ollama_fast: OLLAMA_FAST,
  ollama_balanced: OLLAMA_BALANCED,
}

/** Get a prompt profile by name. */
export function getPromptProfile(name: PromptProfileName): PromptProfile {
  return PROMPT_PROFILES[name]
}

/** Section-level token budgets for system prompt construction. */
export const TOKEN_BUDGETS = {
  /** Total prompt budget */
  total: 32_000,
  /** Agent identity section */
  identity: 1_000,
  /** Session context (startup report, scope, gap flags) */
  session: 500,
  /** Global cap for all sibling digests combined */
  siblingGlobal: 4_000,
  /** Per-sibling digest cap */
  siblingPerDomain: 1_500,
  /** Shared protocols section */
  sharedProtocols: 2_000,
  /** Domain-specific protocols section */
  domainProtocols: 2_000,
  /** Escalation triggers section */
  escalation: 500,
  /** KB update instructions format spec */
  kbInstructions: 500,
  /** Primary KB content (remainder after all other sections) */
  primaryKB: 21_500,
  /** Status briefing section (only when status intent detected) */
  statusBriefing: 900,
  /** Active skill procedure — NOTE: this is a character cap, not token count */
  skill: 12_000,
  /** Active command procedure + arguments — NOTE: this is a character cap, not token count */
  command: 12_000,
  /** Maximum characters for command arguments */
  commandArgs: 8_000,
} as const
