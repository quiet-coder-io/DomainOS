/**
 * Tests for provider-factory.ts — factory instantiation, known models, defaults.
 */
import { describe, it, expect } from 'vitest'
import {
  createProvider,
  KNOWN_MODELS,
  DEFAULT_MODELS,
} from '../../src/agents/provider-factory.js'
import type { ProviderName } from '../../src/agents/provider-factory.js'
import { AnthropicProvider } from '../../src/agents/anthropic-provider.js'
import { OpenAIProvider } from '../../src/agents/openai-provider.js'
import { OllamaProvider } from '../../src/agents/ollama-provider.js'

describe('createProvider', () => {
  it('creates AnthropicProvider', () => {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
    })
    expect(provider).toBeInstanceOf(AnthropicProvider)
    expect(provider.name).toBe('anthropic')
  })

  it('creates OpenAIProvider', () => {
    const provider = createProvider({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
    })
    expect(provider).toBeInstanceOf(OpenAIProvider)
    expect(provider.name).toBe('openai')
  })

  it('creates OllamaProvider', () => {
    const provider = createProvider({
      provider: 'ollama',
      model: 'llama3.2',
      ollamaBaseUrl: 'http://localhost:11434',
    })
    expect(provider).toBeInstanceOf(OllamaProvider)
    expect(provider.name).toBe('ollama')
  })

  it('throws for Anthropic without apiKey', () => {
    expect(() => createProvider({ provider: 'anthropic', model: 'x' })).toThrow('API key is required')
  })

  it('throws for OpenAI without apiKey', () => {
    expect(() => createProvider({ provider: 'openai', model: 'x' })).toThrow('API key is required')
  })

  it('does NOT throw for Ollama without apiKey', () => {
    expect(() => createProvider({ provider: 'ollama', model: 'llama3.2' })).not.toThrow()
  })
})

describe('KNOWN_MODELS', () => {
  it('has entries for all three providers', () => {
    const providers: ProviderName[] = ['anthropic', 'openai', 'ollama']
    for (const p of providers) {
      expect(KNOWN_MODELS[p]).toBeDefined()
      expect(KNOWN_MODELS[p].length).toBeGreaterThan(0)
    }
  })

  it('anthropic includes claude-sonnet', () => {
    expect(KNOWN_MODELS.anthropic).toContain('claude-sonnet-4-20250514')
  })

  it('openai includes gpt-4o', () => {
    expect(KNOWN_MODELS.openai).toContain('gpt-4o')
  })

  it('ollama includes llama3.2', () => {
    expect(KNOWN_MODELS.ollama).toContain('llama3.2')
  })
})

describe('DEFAULT_MODELS', () => {
  it('has a default for all three providers', () => {
    expect(DEFAULT_MODELS.anthropic).toBeDefined()
    expect(DEFAULT_MODELS.openai).toBeDefined()
    expect(DEFAULT_MODELS.ollama).toBeDefined()
  })

  it('defaults are in known models', () => {
    const providers: ProviderName[] = ['anthropic', 'openai', 'ollama']
    for (const p of providers) {
      expect(KNOWN_MODELS[p]).toContain(DEFAULT_MODELS[p])
    }
  })
})
