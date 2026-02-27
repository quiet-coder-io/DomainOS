/**
 * Embedding client interface — framework-agnostic contract for vector embedding providers.
 * Concrete implementations live in apps/desktop/ (Ollama, OpenAI).
 */

export interface EmbeddingClient {
  /** Embed one or more texts into vectors. Each vector is L2-normalized. */
  embed(texts: string[]): Promise<EmbedResult>
  readonly modelName: string
  readonly dimensions: number
  /** Detects silent model changes. Format: "${provider}:${model}:${version}" */
  readonly providerFingerprint: string
}

export interface EmbedResult {
  /** Each vector already L2-normalized by the client. */
  embeddings: number[][]
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'openai'
  model: string
  ollamaBaseUrl?: string
  openaiApiKey?: string
}
