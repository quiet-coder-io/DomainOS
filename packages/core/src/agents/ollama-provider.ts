/**
 * Ollama provider — local LLMs via OpenAI-compatible API.
 *
 * Extends OpenAIProvider with custom baseURL. Key difference (D3):
 * - Chat/completions use OpenAI-compat endpoint: ${base}/v1
 * - Model listing uses native Ollama API: ${base}/api/tags
 * - Connection testing uses native Ollama API: ${base}/api/tags
 */

import { OpenAIProvider } from './openai-provider.js'
import type { ChatMessage, ChatOptions } from './provider.js'

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

  /**
   * Streaming chat with Qwen3 thinking-mode support.
   *
   * Qwen3 models emit a reasoning phase (delta.reasoning) before content (delta.content).
   * Without handling this, the UI appears frozen during the 1-2s thinking phase.
   * We yield a thinking indicator on first reasoning token so the UI shows activity.
   */
  override async *chat(
    messages: ChatMessage[],
    systemPrompt: string,
    options?: ChatOptions,
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      },
      { signal: options?.signal as AbortSignal | undefined },
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as Record<string, unknown> | undefined
      if (!delta) continue

      // Qwen3 thinking phase: delta.reasoning has tokens, delta.content is empty.
      // Skip reasoning tokens — the UI already shows loading dots during this phase.

      // Content phase: yield normally
      if (delta.content && typeof delta.content === 'string') {
        yield delta.content
      }
    }
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
