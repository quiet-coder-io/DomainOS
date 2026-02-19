/**
 * Tests for Ollama provider — URL normalization, provider instantiation.
 */
import { describe, it, expect } from 'vitest'
import { normalizeOllamaUrl, OllamaProvider } from '../../src/agents/ollama-provider.js'

describe('normalizeOllamaUrl', () => {
  it('passes through clean URL', () => {
    expect(normalizeOllamaUrl('http://localhost:11434')).toBe('http://localhost:11434')
  })

  it('strips trailing slashes', () => {
    expect(normalizeOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeOllamaUrl('http://localhost:11434///')).toBe('http://localhost:11434')
  })

  it('strips /v1 suffix to prevent double-suffix', () => {
    expect(normalizeOllamaUrl('http://localhost:11434/v1')).toBe('http://localhost:11434')
  })

  it('strips trailing slash then /v1', () => {
    expect(normalizeOllamaUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434')
  })

  it('requires http:// or https://', () => {
    expect(() => normalizeOllamaUrl('localhost:11434')).toThrow('must start with http')
    expect(() => normalizeOllamaUrl('ftp://localhost:11434')).toThrow('must start with http')
  })

  it('allows https', () => {
    expect(normalizeOllamaUrl('https://remote.host:11434')).toBe('https://remote.host:11434')
  })

  it('trims whitespace', () => {
    expect(normalizeOllamaUrl('  http://localhost:11434  ')).toBe('http://localhost:11434')
  })
})

describe('OllamaProvider', () => {
  it('instantiates with default baseUrl', () => {
    const provider = new OllamaProvider({ model: 'llama3.2' })
    expect(provider.name).toBe('ollama')
  })

  it('instantiates with custom baseUrl', () => {
    const provider = new OllamaProvider({
      model: 'mistral',
      baseUrl: 'http://remote:11434',
    })
    expect(provider.name).toBe('ollama')
  })

  it('handles /v1 in baseUrl without double-suffix', () => {
    // Should not throw — normalizeOllamaUrl strips /v1
    const provider = new OllamaProvider({
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(provider.name).toBe('ollama')
  })

  it('throws for invalid URL scheme', () => {
    expect(() => new OllamaProvider({
      model: 'llama3',
      baseUrl: 'ftp://bad-scheme',
    })).toThrow('must start with http')
  })
})
