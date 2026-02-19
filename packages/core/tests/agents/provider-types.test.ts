/**
 * Tests for provider.ts — capability cache, routing, error helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ToolsNotSupportedError,
  isToolCapableProvider,
  toolCapKey,
  getToolCapability,
  setToolCapability,
  shouldUseTools,
  maybeWrapToolsNotSupported,
  toolCapabilityCache,
  notObservedCounters,
} from '../../src/agents/provider.js'
import type { LLMProvider, ToolCapableProvider, ToolUseMessage, ToolUseResponse } from '../../src/agents/provider.js'

// --- Mock providers ---

function makePlainProvider(name = 'test'): LLMProvider {
  return {
    name,
    async *chat() { yield 'hello' },
    async chatComplete() { return { ok: true as const, value: 'done' } },
  }
}

function makeToolCapableProvider(name = 'test'): ToolCapableProvider {
  return {
    ...makePlainProvider(name),
    supportsTools: true,
    async createToolUseMessage(): Promise<ToolUseResponse> {
      return { stopReason: 'end_turn', textContent: '', toolCalls: [], rawAssistantMessage: {} }
    },
  }
}

beforeEach(() => {
  toolCapabilityCache.clear()
  notObservedCounters.clear()
})

describe('ToolsNotSupportedError', () => {
  it('has correct code and name', () => {
    const err = new ToolsNotSupportedError()
    expect(err.code).toBe('TOOLS_NOT_SUPPORTED')
    expect(err.name).toBe('ToolsNotSupportedError')
    expect(err.message).toBe('Model does not support tool use')
  })

  it('accepts custom message', () => {
    const err = new ToolsNotSupportedError('custom msg')
    expect(err.message).toBe('custom msg')
  })

  it('is instanceof Error', () => {
    expect(new ToolsNotSupportedError() instanceof Error).toBe(true)
  })
})

describe('isToolCapableProvider', () => {
  it('returns true for ToolCapableProvider', () => {
    expect(isToolCapableProvider(makeToolCapableProvider())).toBe(true)
  })

  it('returns false for plain LLMProvider', () => {
    expect(isToolCapableProvider(makePlainProvider())).toBe(false)
  })
})

describe('toolCapKey', () => {
  it('non-Ollama key: provider:model', () => {
    expect(toolCapKey('anthropic', 'claude-3')).toBe('anthropic:claude-3')
    expect(toolCapKey('openai', 'gpt-4o')).toBe('openai:gpt-4o')
  })

  it('Ollama key includes baseUrl', () => {
    expect(toolCapKey('ollama', 'llama3', 'http://localhost:11434')).toBe('ollama:llama3:http://localhost:11434')
  })

  it('Ollama key with no baseUrl uses empty string', () => {
    expect(toolCapKey('ollama', 'llama3')).toBe('ollama:llama3:')
  })

  it('Ollama URL change produces different key', () => {
    const k1 = toolCapKey('ollama', 'llama3', 'http://localhost:11434')
    const k2 = toolCapKey('ollama', 'llama3', 'http://remote:11434')
    expect(k1).not.toBe(k2)
  })
})

describe('capability cache (get/set)', () => {
  it('returns unknown for uncached entries', () => {
    expect(getToolCapability('openai', 'gpt-4o')).toBe('unknown')
  })

  it('round-trips cached values', () => {
    setToolCapability('openai', 'gpt-4o', 'supported')
    expect(getToolCapability('openai', 'gpt-4o')).toBe('supported')
  })

  it('overwrites previous values', () => {
    setToolCapability('openai', 'gpt-4o', 'unknown')
    setToolCapability('openai', 'gpt-4o', 'not_supported')
    expect(getToolCapability('openai', 'gpt-4o')).toBe('not_supported')
  })
})

describe('shouldUseTools', () => {
  it('returns false for plain provider', () => {
    expect(shouldUseTools(makePlainProvider(), 'test', 'model', {})).toBe(false)
  })

  it('returns true for tool-capable + unknown cache', () => {
    expect(shouldUseTools(makeToolCapableProvider(), 'test', 'model', {})).toBe(true)
  })

  it('returns true for tool-capable + supported cache', () => {
    setToolCapability('test', 'model', 'supported')
    expect(shouldUseTools(makeToolCapableProvider(), 'test', 'model', {})).toBe(true)
  })

  it('returns false for not_supported', () => {
    setToolCapability('test', 'model', 'not_supported')
    expect(shouldUseTools(makeToolCapableProvider(), 'test', 'model', {})).toBe(false)
  })

  it('returns false for not_observed without forceToolAttempt', () => {
    setToolCapability('test', 'model', 'not_observed')
    expect(shouldUseTools(makeToolCapableProvider(), 'test', 'model', {})).toBe(false)
  })

  it('returns true for not_observed with forceToolAttempt', () => {
    setToolCapability('test', 'model', 'not_observed')
    expect(shouldUseTools(makeToolCapableProvider(), 'test', 'model', { forceToolAttempt: true })).toBe(true)
  })
})

describe('maybeWrapToolsNotSupported', () => {
  it('returns the error itself if already ToolsNotSupportedError', () => {
    const err = new ToolsNotSupportedError('orig')
    const result = maybeWrapToolsNotSupported(err)
    expect(result).toBe(err)
  })

  it('wraps error with matching message pattern', () => {
    const err = new Error('unknown field: tools')
    const result = maybeWrapToolsNotSupported(err)
    expect(result).toBeInstanceOf(ToolsNotSupportedError)
    expect(result!.message).toBe('unknown field: tools')
  })

  it('wraps "tool not supported" pattern', () => {
    const result = maybeWrapToolsNotSupported(new Error('Tool not supported by this model'))
    expect(result).toBeInstanceOf(ToolsNotSupportedError)
  })

  it('wraps "invalid tool" pattern', () => {
    const result = maybeWrapToolsNotSupported(new Error('invalid tool configuration'))
    expect(result).toBeInstanceOf(ToolsNotSupportedError)
  })

  it('returns null for unrelated errors', () => {
    expect(maybeWrapToolsNotSupported(new Error('network timeout'))).toBeNull()
    expect(maybeWrapToolsNotSupported(new Error('rate limited'))).toBeNull()
  })

  it('handles string errors', () => {
    const result = maybeWrapToolsNotSupported('tools not supported here')
    expect(result).toBeInstanceOf(ToolsNotSupportedError)
  })

  it('returns null for non-matching strings', () => {
    expect(maybeWrapToolsNotSupported('some other error')).toBeNull()
  })
})
