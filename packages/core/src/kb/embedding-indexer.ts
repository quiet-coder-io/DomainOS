/**
 * Embedding indexer — chunks KB files and embeds them via a provided client.
 * Supports incremental indexing (only re-processes changed files/chunks).
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBFile, IndexingProgress } from './schemas.js'
import type { EmbeddingClient } from './embedding-client.js'
import type { KBChunkRepository, EmbeddingBatch } from './chunk-repository.js'
import { chunkMarkdownFile } from './chunker.js'

const EMBED_BATCH_SIZE = 50
const EMBED_BATCH_CHARS = 100_000

export async function indexDomainKB(
  domainId: string,
  kbPath: string,
  kbFiles: KBFile[],
  chunkRepo: KBChunkRepository,
  embeddingClient: EmbeddingClient,
  onProgress?: (progress: IndexingProgress) => void,
  signal?: AbortSignal,
): Promise<Result<IndexingProgress, DomainOSError>> {
  const startTime = Date.now()
  const runId = uuidv4()

  const progress: IndexingProgress = {
    domainId,
    totalFiles: kbFiles.length,
    processedFiles: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    status: 'running',
  }

  // Update job status to running
  chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, {
    runId,
    providerFingerprint: embeddingClient.providerFingerprint,
    status: 'running',
    totalFiles: kbFiles.length,
    processedFiles: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    startedAt: new Date().toISOString(),
  })

  try {
    // Phase 1: Chunk all changed files
    for (const file of kbFiles) {
      if (signal?.aborted) {
        progress.status = 'idle'
        progress.error = 'Cancelled'
        chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress })
        return Ok(progress)
      }

      // Only process markdown files
      if (!file.relativePath.toLowerCase().endsWith('.md')) {
        progress.processedFiles++
        continue
      }

      try {
        const absPath = join(kbPath, file.relativePath)
        const content = await readFile(absPath, 'utf-8')

        // Chunk the file
        const chunks = chunkMarkdownFile(file.id, content)
        if (chunks.length === 0) {
          progress.processedFiles++
          continue
        }

        // Sync chunks with DB (handles insert/update/delete)
        const syncResult = chunkRepo.syncChunks(file.id, file.contentHash, chunks)
        if (!syncResult.ok) {
          console.warn(`[embedding] chunk sync failed for ${file.relativePath}: ${syncResult.error.message}`)
          progress.processedFiles++
          continue
        }

        progress.totalChunks += syncResult.value.insertedIds.length + syncResult.value.updatedIds.length + syncResult.value.unchangedIds.length
      } catch (err) {
        console.warn(`[embedding] failed to read/chunk ${file.relativePath}: ${err instanceof Error ? err.message : String(err)}`)
      }

      progress.processedFiles++
      onProgress?.(progress)
      chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress })
    }

    // Phase 2: Embed chunks that need it
    const needsEmbedding = chunkRepo.getChunksNeedingEmbedding(
      domainId,
      embeddingClient.modelName,
      embeddingClient.providerFingerprint,
    )
    if (!needsEmbedding.ok) {
      progress.status = 'error'
      progress.error = needsEmbedding.error.message
      chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress, lastError: progress.error })
      return Err(needsEmbedding.error)
    }

    const chunksToEmbed = needsEmbedding.value

    // Process in batches with backpressure
    let batchStart = 0
    while (batchStart < chunksToEmbed.length) {
      if (signal?.aborted) {
        progress.status = 'idle'
        progress.error = 'Cancelled'
        chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress })
        return Ok(progress)
      }

      // Build batch respecting size limits
      let batchEnd = batchStart
      let batchChars = 0
      while (batchEnd < chunksToEmbed.length && batchEnd - batchStart < EMBED_BATCH_SIZE) {
        const chunkChars = chunksToEmbed[batchEnd].content.length
        if (batchChars + chunkChars > EMBED_BATCH_CHARS && batchEnd > batchStart) break
        batchChars += chunkChars
        batchEnd++
      }

      const batch = chunksToEmbed.slice(batchStart, batchEnd)
      const texts = batch.map(c => c.content)

      try {
        const embedResult = await embeddingClient.embed(texts)

        const embeddingBatch: EmbeddingBatch[] = batch.map((chunk, idx) => ({
          chunkId: chunk.id,
          modelName: embeddingClient.modelName,
          dimensions: embeddingClient.dimensions,
          embedding: embedResult.embeddings[idx],
          contentHash: chunk.contentHash,
          providerFingerprint: embeddingClient.providerFingerprint,
        }))

        const storeResult = chunkRepo.storeEmbeddings(embeddingBatch)
        if (storeResult.ok) {
          progress.embeddedChunks += storeResult.value
        }
      } catch (err) {
        console.warn(`[embedding] batch embed failed: ${err instanceof Error ? err.message : String(err)}`)
        // Continue with remaining batches — partial success is better than none
      }

      batchStart = batchEnd
      onProgress?.(progress)
      chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress })
    }

    // Done
    progress.status = 'idle'
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[embedding] indexed ${progress.embeddedChunks} chunks for domain ${domainId.slice(0, 8)} in ${elapsed}s`)

    chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, { ...progress })
    onProgress?.(progress)

    return Ok(progress)
  } catch (err) {
    progress.status = 'error'
    progress.error = err instanceof Error ? err.message : String(err)
    chunkRepo.updateJobStatus(domainId, embeddingClient.modelName, {
      ...progress,
      lastError: progress.error,
    })
    return Err(DomainOSError.io(`Indexing failed: ${progress.error}`))
  }
}
