/**
 * Ollama embedding client — calls /api/embed for local vector embeddings.
 * L2-normalizes each vector before returning.
 */

import type { EmbeddingClient, EmbedResult } from '@domain-os/core'

const MAX_BATCH_SIZE = 50
const MAX_BATCH_CHARS = 100_000
const TIMEOUT_MS = 30_000

function l2Normalize(vec: number[]): number[] {
  let norm = 0
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}

export class OllamaEmbeddingClient implements EmbeddingClient {
  readonly modelName: string
  private _dimensions: number
  private readonly baseUrl: string
  private _providerFingerprint: string

  get dimensions(): number {
    return this._dimensions
  }

  get providerFingerprint(): string {
    return this._providerFingerprint
  }

  constructor(options: {
    model: string
    baseUrl?: string
    dimensions: number
    providerFingerprint?: string
  }) {
    this.modelName = options.model
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '')
    this._dimensions = options.dimensions
    this._providerFingerprint = options.providerFingerprint ?? `ollama:${options.model}:unknown`
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { embeddings: [] }
    }

    const allEmbeddings: number[][] = []

    // Process in batches respecting size limits
    let batchStart = 0
    while (batchStart < texts.length) {
      let batchEnd = batchStart
      let batchChars = 0

      while (batchEnd < texts.length && batchEnd - batchStart < MAX_BATCH_SIZE) {
        const textChars = texts[batchEnd].length
        if (batchChars + textChars > MAX_BATCH_CHARS && batchEnd > batchStart) break
        batchChars += textChars
        batchEnd++
      }

      const batchTexts = texts.slice(batchStart, batchEnd)
      const batchResult = await this.embedBatch(batchTexts)
      allEmbeddings.push(...batchResult)

      batchStart = batchEnd
    }

    return { embeddings: allEmbeddings }
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelName, input: texts }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Ollama embed failed (${response.status}): ${body.slice(0, 200)}`)
      }

      const data = await response.json() as { embeddings: number[][] }
      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error('Ollama embed response missing embeddings array')
      }

      // Update dimensions from actual response
      if (data.embeddings.length > 0 && data.embeddings[0].length !== this._dimensions) {
        this._dimensions = data.embeddings[0].length
      }

      return data.embeddings.map(l2Normalize)
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Create an OllamaEmbeddingClient with a smoke test to verify the model is available.
   * Detects actual dimensions from the first embed call.
   */
  static async create(options: {
    model: string
    baseUrl?: string
  }): Promise<OllamaEmbeddingClient> {
    const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '')

    // Smoke test: embed a single input to verify model + detect dimensions
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: ['test'] }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(
          `Ollama embedding model "${options.model}" not available (${response.status}). ` +
          `Try: ollama pull ${options.model}\n${body.slice(0, 200)}`,
        )
      }

      const data = await response.json() as { embeddings: number[][] }
      if (!data.embeddings?.[0]) {
        throw new Error(`Ollama returned empty embeddings for model "${options.model}"`)
      }

      const dimensions = data.embeddings[0].length

      // Try to get model fingerprint via /api/show
      let fingerprint = `ollama:${options.model}:unknown`
      try {
        const showResp = await fetch(`${baseUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: options.model }),
        })
        if (showResp.ok) {
          const showData = await showResp.json() as { digest?: string }
          if (showData.digest) {
            fingerprint = `ollama:${options.model}:${showData.digest.slice(0, 12)}`
          }
        }
      } catch {
        // Fingerprint is best-effort
      }

      return new OllamaEmbeddingClient({
        model: options.model,
        baseUrl: options.baseUrl,
        dimensions,
        providerFingerprint: fingerprint,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
