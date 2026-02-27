/**
 * Per-domain embedding job manager with dirty-flag coalescing.
 * Ensures only one indexing job runs per domain at a time.
 */

import type { EmbeddingClient, KBFile, IndexingProgress } from '@domain-os/core'
import type { KBChunkRepository } from '@domain-os/core'
import { indexDomainKB } from '@domain-os/core'
import { EmbeddingCache } from './embedding-cache.js'

interface ActiveJob {
  controller: AbortController
  dirty: boolean
  promise: Promise<void>
}

export class EmbeddingManager {
  private activeJobs = new Map<string, ActiveJob>()
  private embeddingClient: EmbeddingClient | null = null
  private chunkRepo: KBChunkRepository
  private cache: EmbeddingCache
  private onProgress?: (domainId: string, progress: IndexingProgress) => void

  constructor(options: {
    chunkRepo: KBChunkRepository
    cache: EmbeddingCache
    embeddingClient?: EmbeddingClient | null
    onProgress?: (domainId: string, progress: IndexingProgress) => void
  }) {
    this.chunkRepo = options.chunkRepo
    this.cache = options.cache
    this.embeddingClient = options.embeddingClient ?? null
    this.onProgress = options.onProgress
  }

  /** Update the embedding client (e.g., after settings change). */
  updateClient(client: EmbeddingClient | null): void {
    this.embeddingClient = client
  }

  /** Get current embedding client (for use by chat handler). */
  getClient(): EmbeddingClient | null {
    return this.embeddingClient
  }

  /**
   * Start or coalesce an indexing job for a domain.
   * If already running, sets dirty flag so the job re-loops after current file.
   */
  async indexDomain(domainId: string, kbPath: string, kbFiles: KBFile[]): Promise<void> {
    if (!this.embeddingClient) return

    const existing = this.activeJobs.get(domainId)
    if (existing) {
      // Coalesce: mark dirty so the running job will re-loop
      existing.dirty = true
      return
    }

    const controller = new AbortController()
    const job: ActiveJob = { controller, dirty: false, promise: Promise.resolve() }

    job.promise = this.runIndexLoop(domainId, kbPath, kbFiles, job)
    this.activeJobs.set(domainId, job)

    // Don't await — fire and forget
    job.promise.finally(() => {
      this.activeJobs.delete(domainId)
    })
  }

  private async runIndexLoop(
    domainId: string,
    kbPath: string,
    kbFiles: KBFile[],
    job: ActiveJob,
  ): Promise<void> {
    if (!this.embeddingClient) return

    let currentFiles = kbFiles

    // eslint-disable-next-line no-constant-condition
    while (true) {
      job.dirty = false

      try {
        await indexDomainKB(
          domainId,
          kbPath,
          currentFiles,
          this.chunkRepo,
          this.embeddingClient,
          (progress) => {
            this.onProgress?.(domainId, progress)
          },
          job.controller.signal,
        )
      } catch (err) {
        console.error(`[embedding-manager] indexing failed for ${domainId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
      }

      // Invalidate cache after indexing
      this.cache.invalidate(domainId, this.embeddingClient.modelName)

      // If marked dirty during run, loop with fresh files
      if (job.dirty && !job.controller.signal.aborted) {
        // Re-use same files (watcher will trigger new index with fresh files if needed)
        continue
      }

      break
    }
  }

  /** Hard cancel — for model/provider change or domain deletion. */
  cancel(domainId: string): void {
    const job = this.activeJobs.get(domainId)
    if (job) {
      job.controller.abort()
      this.activeJobs.delete(domainId)
    }
  }

  /** Hard cancel all — app shutdown. */
  cancelAll(): void {
    for (const [domainId, job] of this.activeJobs) {
      job.controller.abort()
    }
    this.activeJobs.clear()
  }

  /** Check if indexing is in progress for a domain. */
  isIndexing(domainId: string): boolean {
    return this.activeJobs.has(domainId)
  }
}
