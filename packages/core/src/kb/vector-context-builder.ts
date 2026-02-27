/**
 * Vector-based KB context builder — semantic retrieval with tier-aware packing.
 * Replaces tier-based file loading with relevance-based chunk retrieval when embeddings are available.
 * Falls back to existing context builders when unavailable.
 */

import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBFile, KBContext, KBContextFile, StoredEmbedding } from './schemas.js'
import type { EmbeddingClient } from './embedding-client.js'
import type { KBChunkRepository } from './chunk-repository.js'
import { searchChunksWithDiversity } from './vector-search.js'
import { buildKBContextDigestPlusStructural } from './context-builder.js'

export interface VectorContextOptions {
  domainId: string
  kbPath: string
  queryText: string
  embeddingClient: EmbeddingClient
  chunkRepo: KBChunkRepository
  kbFiles: KBFile[]
  tokenBudget: number
  cachedEmbeddings?: StoredEmbedding[]
  topK?: number
  minScore?: number
  maxStructuralChunks?: number
}

export async function buildVectorKBContext(options: VectorContextOptions): Promise<Result<KBContext, DomainOSError>> {
  const {
    domainId,
    kbPath,
    queryText,
    embeddingClient,
    chunkRepo,
    kbFiles,
    tokenBudget,
    cachedEmbeddings,
    topK = 10,
    minScore = 0.3,
    maxStructuralChunks = 3,
  } = options

  const charBudget = tokenBudget * 4

  try {
    // 1. Embed the user query
    let queryEmbedding: Float32Array
    try {
      const embedResult = await embeddingClient.embed([queryText])
      if (!embedResult.embeddings.length) {
        return fallback(kbPath, kbFiles, tokenBudget, 'Empty embedding result')
      }
      queryEmbedding = Float32Array.from(embedResult.embeddings[0])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[vector-search] embed failed, falling back: ${msg}`)
      return fallback(kbPath, kbFiles, tokenBudget, msg)
    }

    // 2. Load stored embeddings
    const storedEmbeddings = cachedEmbeddings ?? loadEmbeddings(chunkRepo, domainId, embeddingClient.modelName)
    if (storedEmbeddings.length === 0) {
      return fallback(kbPath, kbFiles, tokenBudget, 'No embeddings indexed')
    }

    // 3. Semantic search with diversity
    const searchResults = searchChunksWithDiversity(queryEmbedding, storedEmbeddings, {
      topK,
      minScore,
    })

    if (searchResults.length === 0) {
      return fallback(kbPath, kbFiles, tokenBudget, 'All scores below minScore')
    }

    // Log top scores for debugging
    const topScores = searchResults.slice(0, 3).map(r => r.score.toFixed(2)).join(', ')
    const uniqueFiles = new Set(searchResults.map(r => r.kbFileId)).size
    console.log(`[vector-search] top-${Math.min(3, searchResults.length)} scores: ${topScores} (${uniqueFiles} files)`)

    // 4. Build file lookup for tier/staleness labels
    const kbFileById = new Map(kbFiles.map(f => [f.id, f]))

    // 5. Pack semantic results (primary context)
    const resultFiles: KBContextFile[] = []
    let totalChars = 0
    let truncated = false
    const budgetLimit = charBudget * 0.95 // Stop at 95% to leave room for structural

    const includedChunkIds = new Set<string>()

    for (const result of searchResults) {
      const file = kbFileById.get(result.kbFileId)
      const tierLabel = file ? `[${file.tier.toUpperCase()}]` : '[GENERAL]'
      const header = `--- ${tierLabel} [score: ${result.score.toFixed(2)}] ${result.headingPath || 'body'} ---\n`
      const block = header + result.content
      const blockChars = block.length

      if (totalChars + blockChars > budgetLimit) {
        // Try to fit partial
        const remaining = budgetLimit - totalChars - header.length
        if (remaining > 50) {
          const truncContent = result.content.slice(0, remaining) + '\n...[TRUNCATED]'
          resultFiles.push({
            path: result.headingPath || `chunk:${result.chunkId.slice(0, 8)}`,
            content: truncContent,
            tier: file?.tier,
          })
          totalChars += header.length + truncContent.length
        }
        truncated = true
        break
      }

      resultFiles.push({
        path: result.headingPath || `chunk:${result.chunkId.slice(0, 8)}`,
        content: result.content,
        tier: file?.tier,
      })
      totalChars += blockChars
      includedChunkIds.add(result.chunkId)
    }

    // 6. Structural reserve — append top structural chunks not already included
    const structuralEmbeddings = storedEmbeddings.filter(e => {
      const file = kbFileById.get(e.kbFileId)
      return file?.tier === 'structural' && !includedChunkIds.has(e.chunkId)
    })

    if (structuralEmbeddings.length > 0) {
      // Score structural embeddings against query
      const structuralResults = searchChunksWithDiversity(queryEmbedding, structuralEmbeddings, {
        topK: maxStructuralChunks,
        minScore: 0.15,
      })

      for (const result of structuralResults) {
        if (totalChars >= charBudget * 0.95) break
        const file = kbFileById.get(result.kbFileId)
        const header = `--- [STRUCTURAL] ${result.headingPath || 'identity'} ---\n`
        const block = header + result.content
        const blockChars = block.length

        if (totalChars + blockChars > charBudget) {
          truncated = true
          break
        }

        resultFiles.push({
          path: result.headingPath || `structural:${result.chunkId.slice(0, 8)}`,
          content: result.content,
          tier: 'structural',
        })
        totalChars += blockChars
      }
    }

    return Ok({ files: resultFiles, totalChars, truncated })
  } catch (err) {
    return Err(
      DomainOSError.io(`Vector context build failed: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
}

function loadEmbeddings(chunkRepo: KBChunkRepository, domainId: string, modelName: string): StoredEmbedding[] {
  const result = chunkRepo.getEmbeddings(domainId, modelName)
  if (!result.ok) {
    console.warn(`[vector-search] failed to load embeddings: ${result.error.message}`)
    return []
  }
  return result.value
}

async function fallback(
  kbPath: string,
  kbFiles: KBFile[],
  tokenBudget: number,
  reason: string,
): Promise<Result<KBContext, DomainOSError>> {
  console.log(`[vector-search] falling back to digest+structural: ${reason}`)
  return buildKBContextDigestPlusStructural(kbPath, kbFiles, tokenBudget)
}
