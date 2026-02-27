/**
 * Provider factory — creates LLM provider instances from configuration.
 *
 * Centralizes provider instantiation and exposes known model lists for UI dropdowns.
 * Custom model strings are always accepted (validation: non-empty, ≤128 chars).
 */

import type { LLMProvider } from './provider.js'
import { AnthropicProvider } from './anthropic-provider.js'
import { OpenAIProvider } from './openai-provider.js'
import { OllamaProvider } from './ollama-provider.js'

export type ProviderName = 'anthropic' | 'openai' | 'ollama'

export interface ProviderConfig {
  provider: ProviderName
  model: string
  apiKey?: string
  ollamaBaseUrl?: string
  maxTokens?: number
}

/** Known models for UI dropdowns — custom strings always accepted (D4). */
export const KNOWN_MODELS: Record<ProviderName, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o3-mini',
  ],
  ollama: [
    'qwen3:30b-a3b-32k',
    'qwen3:30b-a3b',
    'qwen3:32b',
    'llama3.1',
    'mistral',
  ],
}

/** Default model per provider — used when modelName is null but modelProvider is set. */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'qwen3:30b-a3b-32k',
}

/**
 * Create a provider instance from configuration.
 * Throws if required fields are missing (e.g., apiKey for non-Ollama providers).
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic': {
      if (!config.apiKey) throw new Error('Anthropic API key is required')
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
      })
    }
    case 'openai': {
      if (!config.apiKey) throw new Error('OpenAI API key is required')
      return new OpenAIProvider({
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
      })
    }
    case 'ollama': {
      return new OllamaProvider({
        model: config.model,
        baseUrl: config.ollamaBaseUrl,
        maxTokens: config.maxTokens,
      })
    }
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
