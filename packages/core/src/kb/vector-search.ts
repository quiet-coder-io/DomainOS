/**
 * Vector search utilities — cosine similarity, MMR diversity, Float32 helpers.
 */

import type { StoredEmbedding, VectorSearchResult } from './schemas.js'

/** Pack a number array into a little-endian Float32 Buffer. */
export function packFloat32(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4)
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4)
  }
  return buf
}

/** Unpack a little-endian Float32 Buffer into a Float32Array. Returns null on corrupt data. */
export function unpackFloat32(blob: Buffer, dims: number): Float32Array | null {
  if (blob.byteLength !== dims * 4) {
    console.warn(`[vector-search] corrupt embedding blob: expected ${dims * 4} bytes, got ${blob.byteLength}`)
    return null
  }
  const arr = new Float32Array(dims)
  for (let i = 0; i < dims; i++) {
    arr[i] = blob.readFloatLE(i * 4)
  }
  return arr
}

/** Cosine similarity between two L2-normalized Float32Arrays. For normalized vectors, this is just the dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/** Heading keywords that get an anchor boost in search. */
export const ANCHOR_HEADING_KEYWORDS = [
  'STATUS', 'OPEN GAP', 'DEADLINE', 'PRIORITIES',
  'NEXT ACTION', 'OVERDUE', 'CRITICAL',
] as const

const ANCHOR_HEADING_RE = /\b(STATUS|OPEN GAP|DEADLINE|PRIORITIES|NEXT ACTION|OVERDUE|CRITICAL)\b/i

/** Check if a heading path matches anchor keywords. Returns boost score (0.1) or 0. */
export function anchorHeadingBoost(headingPath: string): number {
  if (!headingPath) return 0
  return ANCHOR_HEADING_RE.test(headingPath) ? 0.1 : 0
}

export interface SearchOptions {
  topK: number
  minScore?: number
  sameHeadingPenalty?: number
  sameFilePenalty?: number
}

/**
 * MMR-lite diversity selection with two-tier penalty.
 * After picking the best chunk, penalize remaining candidates:
 * - Same file + same heading_path: penalty 0.30
 * - Same file, different heading_path: penalty 0.10
 */
export function searchChunksWithDiversity(
  queryEmbedding: Float32Array,
  storedEmbeddings: StoredEmbedding[],
  options: SearchOptions,
): VectorSearchResult[] {
  const {
    topK,
    minScore = 0.3,
    sameHeadingPenalty = 0.30,
    sameFilePenalty = 0.10,
  } = options

  // Score all candidates
  interface Candidate {
    embedding: StoredEmbedding
    rawScore: number
    effectiveScore: number
  }

  const candidates: Candidate[] = []
  for (const emb of storedEmbeddings) {
    const raw = cosineSimilarity(queryEmbedding, emb.embedding)
    const boost = anchorHeadingBoost(emb.headingPath)
    const score = raw + boost
    if (score >= minScore) {
      candidates.push({ embedding: emb, rawScore: raw, effectiveScore: score })
    }
  }

  // MMR-lite greedy selection
  const selected: VectorSearchResult[] = []
  const usedIndices = new Set<number>()

  for (let pick = 0; pick < topK && candidates.length > usedIndices.size; pick++) {
    // Find best remaining candidate
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < candidates.length; i++) {
      if (usedIndices.has(i)) continue
      if (candidates[i].effectiveScore > bestScore) {
        bestScore = candidates[i].effectiveScore
        bestIdx = i
      }
    }
    if (bestIdx === -1) break

    const picked = candidates[bestIdx]
    usedIndices.add(bestIdx)

    selected.push({
      chunkId: picked.embedding.chunkId,
      kbFileId: picked.embedding.kbFileId,
      domainId: picked.embedding.domainId,
      headingPath: picked.embedding.headingPath,
      content: picked.embedding.content,
      charCount: picked.embedding.charCount,
      tokenEstimate: picked.embedding.tokenEstimate,
      startLine: picked.embedding.startLine,
      endLine: picked.embedding.endLine,
      score: picked.effectiveScore,
    })

    // Apply diversity penalties to remaining candidates
    for (let i = 0; i < candidates.length; i++) {
      if (usedIndices.has(i)) continue
      const c = candidates[i]
      if (c.embedding.kbFileId === picked.embedding.kbFileId) {
        if (c.embedding.headingPath === picked.embedding.headingPath && c.embedding.headingPath !== '') {
          c.effectiveScore -= sameHeadingPenalty
        } else {
          c.effectiveScore -= sameFilePenalty
        }
      }
    }
  }

  return selected
}
