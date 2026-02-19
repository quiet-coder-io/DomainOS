/**
 * LLM provider interface and shared types for agent communication.
 *
 * This file defines the authoritative contract for multi-provider LLM support.
 * All providers (Anthropic, OpenAI, Ollama) implement these interfaces.
 */

import type { Result } from '../common/index.js'
import type { DomainOSError } from '../common/index.js'

// ── Base chat types ──

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMProvider {
  name: string
  chat(messages: ChatMessage[], systemPrompt: string): AsyncIterable<string>
  chatComplete(messages: ChatMessage[], systemPrompt: string): Promise<Result<string, DomainOSError>>
}

// ── Tool definitions ──

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown> // JSON Schema — preserve ALL fields (D5)
}

export interface ToolCall {
  /** Provider's native tool call ID. Must be echoed back in tool results. */
  id: string
  name: string
  input: Record<string, unknown>
}

// ── Typed error for tool capability ──

export class ToolsNotSupportedError extends Error {
  readonly code = 'TOOLS_NOT_SUPPORTED' as const
  constructor(message?: string) {
    super(message ?? 'Model does not support tool use')
    this.name = 'ToolsNotSupportedError'
  }
}

// ── Message types (discriminated union) ──
// Each variant maps 1:1 to a transcript entry.
// One tool result = one message (not bundled into a synthetic role).

export type ToolUseMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; rawMessage: unknown; derivedText?: string }
  // rawMessage is source of truth (opaque provider blob). derivedText is optional, for UI only.
  // Providers MUST round-trip using rawMessage only. Never reconstruct from derivedText.
  | { role: 'tool'; toolCallId: string; toolName: string; content: string }
  // One per tool result — maps to OpenAI role:"tool" and Anthropic tool_result block.
  // toolName baked in for deterministic flattening and logging (no external mapping needed).

// ── Response ──

// ToolUseResponse is ONLY for successful API responses.
// Provider adapters MUST throw on transport/API errors (4xx, 5xx, network).
// ToolsNotSupportedError is thrown, never encoded as a stopReason.
export interface ToolUseResponse {
  // Normalized stop reasons (provider mapping):
  // Anthropic: stop_reason="tool_use" → "tool_use", "end_turn" → "end_turn", "max_tokens" → "max_tokens"
  // OpenAI:    finish_reason="tool_calls" → "tool_use", "stop" → "end_turn", "length" → "max_tokens"
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens'
  /** Derived text for UI display. Anthropic: concatenate text blocks. OpenAI: message.content ?? '' */
  textContent: string
  toolCalls: ToolCall[]
  /** Opaque blob for round-tripping back as role:'assistant'. Never reconstruct from textContent. */
  rawAssistantMessage: unknown
}

// ── Provider interface ──

export interface ToolCapableProvider extends LLMProvider {
  supportsTools: true
  createToolUseMessage(params: {
    messages: ToolUseMessage[]
    systemPrompt: string
    tools: ToolDefinition[]
  }): Promise<ToolUseResponse>
}

/** Type guard: checks if provider implements ToolCapableProvider interface. */
export function isToolCapableProvider(provider: LLMProvider): provider is ToolCapableProvider {
  return 'supportsTools' in provider && (provider as ToolCapableProvider).supportsTools === true
}

// ── Tool capability cache (4-state, in-memory) ──

export type ToolCapability = 'supported' | 'not_observed' | 'not_supported' | 'unknown'

export const toolCapabilityCache: Map<string, ToolCapability> = new Map()

/** Not-observed counter: tracks consecutive rounds where model ignores tools. */
export const notObservedCounters: Map<string, number> = new Map()

/** Canonical key for capability cache lookups. Ollama includes baseUrl to avoid stale entries. */
export function toolCapKey(providerName: string, model: string, ollamaBaseUrl?: string): string {
  return providerName === 'ollama'
    ? `ollama:${model}:${ollamaBaseUrl ?? ''}`
    : `${providerName}:${model}`
}

export function getToolCapability(providerName: string, model: string, ollamaBaseUrl?: string): ToolCapability {
  return toolCapabilityCache.get(toolCapKey(providerName, model, ollamaBaseUrl)) ?? 'unknown'
}

export function setToolCapability(providerName: string, model: string, cap: ToolCapability, ollamaBaseUrl?: string): void {
  toolCapabilityCache.set(toolCapKey(providerName, model, ollamaBaseUrl), cap)
}

/**
 * High-level routing: should we enter the tool loop for this request?
 * Checks provider interface + capability cache + domain forceToolAttempt flag.
 */
export function shouldUseTools(
  provider: LLMProvider,
  providerName: string,
  model: string,
  domain: { forceToolAttempt?: boolean },
  ollamaBaseUrl?: string,
): boolean {
  if (!isToolCapableProvider(provider)) return false
  const cap = getToolCapability(providerName, model, ollamaBaseUrl)
  if (cap === 'not_supported') return false
  if (cap === 'not_observed') return domain.forceToolAttempt === true
  return true // 'supported' or 'unknown'
}

/**
 * Centralized error detection for tool support failures.
 * Returns a ToolsNotSupportedError if the error looks like a tool capability issue,
 * or null if it's a different kind of error.
 */
export function maybeWrapToolsNotSupported(err: unknown): ToolsNotSupportedError | null {
  if (err instanceof ToolsNotSupportedError) return err
  const msg = err instanceof Error ? err.message : String(err)
  if (/tools?.not.supported|does not support tools|unknown.field.*tools|invalid.*tool/i.test(msg)) {
    return new ToolsNotSupportedError(msg)
  }
  return null
}
