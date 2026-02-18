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
