/**
 * In-memory embedding cache — avoids re-loading vectors from SQLite on every chat.
 * Keyed by domain+model, with TTL safety net.
 */

import type { StoredEmbedding } from '@domain-os/core'
import type { KBChunkRepository } from '@domain-os/core'

const TTL_MS = 15 * 60 * 1000 // 15 minutes

interface CacheEntry {
  embeddings: StoredEmbedding[]
  loadedAt: number
}

export class EmbeddingCache {
  private cache = new Map<string, CacheEntry>()

  private key(domainId: string, modelName: string): string {
    return `${domainId}:${modelName}`
  }

  /**
   * Get embeddings from cache or load from DB.
   * Reloads if TTL expired.
   */
  get(domainId: string, modelName: string, chunkRepo: KBChunkRepository): StoredEmbedding[] {
    const k = this.key(domainId, modelName)
    const entry = this.cache.get(k)

    if (entry && Date.now() - entry.loadedAt < TTL_MS) {
      return entry.embeddings
    }

    // Load from DB
    const result = chunkRepo.getEmbeddings(domainId, modelName)
    if (!result.ok) {
      console.warn(`[embedding-cache] failed to load embeddings: ${result.error.message}`)
      return []
    }

    this.cache.set(k, {
      embeddings: result.value,
      loadedAt: Date.now(),
    })

    return result.value
  }

  /**
   * Invalidate cache for a domain. If modelName omitted, invalidate all models for domain.
   */
  invalidate(domainId: string, modelName?: string): void {
    if (modelName) {
      this.cache.delete(this.key(domainId, modelName))
    } else {
      // Invalidate all models for this domain
      for (const k of this.cache.keys()) {
        if (k.startsWith(`${domainId}:`)) {
          this.cache.delete(k)
        }
      }
    }
  }

  /** Clear entire cache. */
  clear(): void {
    this.cache.clear()
  }
}
