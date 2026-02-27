/**
 * Zod schemas and types for the knowledge base module.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const KBTierSchema = z.enum(['structural', 'status', 'intelligence', 'general'])
export const KBTierSourceSchema = z.enum(['inferred', 'manual'])

export const KBFileSchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  relativePath: z.string().min(1),
  contentHash: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  lastSyncedAt: TimestampSchema,
  tier: KBTierSchema.default('general'),
  tierSource: KBTierSourceSchema.default('inferred'),
})

export type KBFile = z.infer<typeof KBFileSchema>

export const KBScannedFileSchema = z.object({
  relativePath: z.string().min(1),
  absolutePath: z.string().min(1),
  hash: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
})

export type KBScannedFile = z.infer<typeof KBScannedFileSchema>

export const KBContextFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  tier: KBTierSchema.optional(),
  stalenessLabel: z.string().optional(),
})

export type KBContextFile = z.infer<typeof KBContextFileSchema>

export const KBContextSchema = z.object({
  files: z.array(KBContextFileSchema),
  totalChars: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export type KBContext = z.infer<typeof KBContextSchema>

export const KBSyncResultSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
})

export type KBSyncResult = z.infer<typeof KBSyncResultSchema>

// --- Vector search schemas ---

export const KBChunkSchema = z.object({
  id: z.string(),
  kbFileId: z.string(),
  domainId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  chunkKey: z.string(),
  headingPath: z.string(),
  content: z.string(),
  contentHash: z.string(),
  fileContentHash: z.string(),
  charCount: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  startLine: z.number().int().nullable(),
  endLine: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type KBChunk = z.infer<typeof KBChunkSchema>

export const EmbeddingJobStatusSchema = z.object({
  domainId: z.string(),
  modelName: z.string(),
  runId: z.string().nullable(),
  providerFingerprint: z.string(),
  status: z.enum(['idle', 'running', 'error']),
  totalFiles: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  embeddedChunks: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
})

export type EmbeddingJobStatus = z.infer<typeof EmbeddingJobStatusSchema>

export const VectorSearchResultSchema = z.object({
  chunkId: z.string(),
  kbFileId: z.string(),
  domainId: z.string(),
  headingPath: z.string(),
  content: z.string(),
  charCount: z.number().int(),
  tokenEstimate: z.number().int(),
  startLine: z.number().int().nullable(),
  endLine: z.number().int().nullable(),
  score: z.number(),
})

export type VectorSearchResult = z.infer<typeof VectorSearchResultSchema>

export interface StoredEmbedding {
  chunkId: string
  kbFileId: string
  domainId: string
  headingPath: string
  content: string
  charCount: number
  tokenEstimate: number
  startLine: number | null
  endLine: number | null
  contentHash: string
  modelName: string
  dimensions: number
  embedding: Float32Array
  providerFingerprint: string
}

export interface IndexingProgress {
  domainId: string
  totalFiles: number
  processedFiles: number
  totalChunks: number
  embeddedChunks: number
  status: 'running' | 'idle' | 'error'
  error?: string
}

export interface SyncChunksResult {
  insertedIds: string[]
  updatedIds: string[]
  unchangedIds: string[]
}

export interface ChunkForEmbedding {
  id: string
  content: string
  contentHash: string
}
