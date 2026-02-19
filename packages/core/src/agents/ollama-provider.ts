/**
 * Ollama provider — local LLMs via OpenAI-compatible API.
 *
 * Extends OpenAIProvider with custom baseURL. Key difference (D3):
 * - Chat/completions use OpenAI-compat endpoint: ${base}/v1
 * - Model listing uses native Ollama API: ${base}/api/tags
 * - Connection testing uses native Ollama API: ${base}/api/tags
 */

import { OpenAIProvider } from './openai-provider.js'

export interface OllamaProviderOptions {
  model: string
  baseUrl?: string
  maxTokens?: number
}

/**
 * Normalize Ollama base URL: trim trailing slashes, strip /v1 suffix if present,
 * validate starts with http:// or https://. Prevents /v1/v1 double-suffix.
 */
export function normalizeOllamaUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '')
  // Strip /v1 suffix if accidentally included
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    throw new Error(`Ollama URL must start with http:// or https://, got: ${normalized}`)
  }
  return normalized
}

export class OllamaProvider extends OpenAIProvider {
  override readonly name = 'ollama'
  private readonly ollamaBaseUrl: string

  constructor(options: OllamaProviderOptions) {
    const base = normalizeOllamaUrl(options.baseUrl ?? 'http://localhost:11434')
    super({
      apiKey: 'ollama', // Dummy key — Ollama doesn't need auth
      model: options.model,
      baseUrl: `${base}/v1`, // OpenAI-compat endpoint for chat/completions
      maxTokens: options.maxTokens,
    })
    this.ollamaBaseUrl = base
  }

  /** List installed models via native Ollama API (not OpenAI /v1/models). */
  static async listModels(baseUrl?: string): Promise<string[]> {
    const base = baseUrl ?? 'http://localhost:11434'
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(`${base}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = (await res.json()) as { models?: Array<{ name: string }> }
      return data.models?.map((m) => m.name) ?? []
    } catch {
      return [] // Network error, timeout, JSON parse error → empty list
    }
  }

  /** Test connection by pinging the native Ollama API. */
  static async testConnection(baseUrl?: string): Promise<boolean> {
    const base = baseUrl ?? 'http://localhost:11434'
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(`${base}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }
}
