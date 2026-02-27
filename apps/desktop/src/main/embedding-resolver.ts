/**
 * Privacy-respecting embedding provider resolution.
 * 'auto' only tries Ollama (local). OpenAI requires explicit selection.
 */

import type { EmbeddingClient } from '@domain-os/core'
import { OllamaEmbeddingClient } from './ollama-embeddings.js'
import { OpenAIEmbeddingClient } from './openai-embeddings.js'

export type EmbeddingProviderSetting = 'auto' | 'ollama' | 'openai' | 'off'

export interface EmbeddingResolverConfig {
  embeddingProvider?: EmbeddingProviderSetting
  embeddingModel?: string
  ollamaBaseUrl?: string
  openaiApiKey?: string
}

/**
 * Resolve an embedding client based on configuration.
 * Returns null when embeddings are disabled or no provider is available.
 *
 * Resolution order:
 * 1. 'off' → null
 * 2. 'ollama' → Ollama (fail if unreachable)
 * 3. 'openai' → OpenAI (fail if no key)
 * 4. 'auto' (default) → try Ollama if reachable, else null
 * OpenAI is NEVER auto-detected.
 */
export async function resolveEmbeddingClient(
  config: EmbeddingResolverConfig,
): Promise<EmbeddingClient | null> {
  const provider = config.embeddingProvider ?? 'auto'

  if (provider === 'off') {
    return null
  }

  if (provider === 'ollama') {
    try {
      return await OllamaEmbeddingClient.create({
        model: config.embeddingModel ?? 'nomic-embed-text',
        baseUrl: config.ollamaBaseUrl,
      })
    } catch (err) {
      console.error(`[embedding] Ollama embedding failed: ${err instanceof Error ? err.message : String(err)}`)
      throw err // Explicit selection should fail visibly
    }
  }

  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI embedding requires an API key. Set one in Settings → API Keys.')
    }
    return new OpenAIEmbeddingClient({
      apiKey: config.openaiApiKey,
      model: config.embeddingModel ?? 'text-embedding-3-small',
    })
  }

  // 'auto': try Ollama silently, return null if unavailable
  try {
    return await OllamaEmbeddingClient.create({
      model: config.embeddingModel ?? 'nomic-embed-text',
      baseUrl: config.ollamaBaseUrl,
    })
  } catch {
    console.log('[embedding] Ollama not available for embeddings, vector search disabled')
    return null
  }
}
