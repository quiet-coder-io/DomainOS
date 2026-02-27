/**
 * OpenAI embedding client — calls OpenAI embeddings API with L2 normalization.
 * Requires explicit opt-in; never auto-detected.
 */

import OpenAI from 'openai'
import type { EmbeddingClient, EmbedResult } from '@domain-os/core'

const MAX_BATCH_SIZE = 2048

function l2Normalize(vec: number[]): number[] {
  let norm = 0
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly modelName: string
  readonly dimensions: number
  readonly providerFingerprint: string
  private readonly client: OpenAI

  constructor(options: {
    apiKey: string
    model?: string
    dimensions?: number
  }) {
    this.modelName = options.model ?? 'text-embedding-3-small'
    this.dimensions = options.dimensions ?? 1536
    this.providerFingerprint = `openai:${this.modelName}:openai`
    this.client = new OpenAI({ apiKey: options.apiKey })
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { embeddings: [] }
    }

    const allEmbeddings: number[][] = []

    // Process in batches respecting API limit
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE)
      const response = await this.client.embeddings.create({
        model: this.modelName,
        input: batch,
      })

      // Sort by index to preserve order (API may return unordered)
      const sorted = response.data.sort((a, b) => a.index - b.index)
      for (const item of sorted) {
        allEmbeddings.push(l2Normalize(item.embedding))
      }
    }

    return { embeddings: allEmbeddings }
  }
}
