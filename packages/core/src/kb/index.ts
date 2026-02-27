/**
 * Knowledge base — structured document storage and retrieval.
 * Manages domain-specific knowledge files, digests, and change logs.
 */

export {
  KBFileSchema,
  KBScannedFileSchema,
  KBContextSchema,
  KBContextFileSchema,
  KBSyncResultSchema,
  KBTierSchema,
  KBTierSourceSchema,
} from './schemas.js'
export type { KBFile, KBScannedFile, KBContext, KBContextFile, KBSyncResult } from './schemas.js'

export { scanKBDirectory } from './scanner.js'
export { KBRepository } from './repository.js'
export { buildKBContext, buildSiblingContext, buildKBContextDigestOnly, buildKBContextDigestPlusStructural } from './context-builder.js'
export { classifyTier, TIER_PRIORITY } from './tiers.js'
export type { KBTier, KBTierSource } from './tiers.js'
export { calculateStaleness, STALENESS_THRESHOLDS } from './staleness.js'
export type { StalenessLevel, StalenessInfo } from './staleness.js'
export { scaffoldKBFiles, KB_TEMPLATES } from './scaffold.js'
export type { ScaffoldInput, ScaffoldResult, ScaffoldFileResult } from './scaffold.js'

// Vector search
export { chunkMarkdownFile, normalizeForAnchor } from './chunker.js'
export type { KBChunkData, ChunkerOptions } from './chunker.js'
export type { EmbeddingClient, EmbedResult, EmbeddingConfig } from './embedding-client.js'
export { KBChunkRepository } from './chunk-repository.js'
export type { EmbeddingBatch } from './chunk-repository.js'
export {
  packFloat32,
  unpackFloat32,
  cosineSimilarity,
  searchChunksWithDiversity,
  anchorHeadingBoost,
  ANCHOR_HEADING_KEYWORDS,
} from './vector-search.js'
export { buildVectorKBContext } from './vector-context-builder.js'
export type { VectorContextOptions } from './vector-context-builder.js'
export { indexDomainKB } from './embedding-indexer.js'
export {
  KBChunkSchema,
  EmbeddingJobStatusSchema,
  VectorSearchResultSchema,
} from './schemas.js'
export type {
  KBChunk,
  EmbeddingJobStatus,
  VectorSearchResult,
  StoredEmbedding,
  IndexingProgress,
  SyncChunksResult,
  ChunkForEmbedding,
} from './schemas.js'
