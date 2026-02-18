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
export { buildKBContext, buildSiblingContext } from './context-builder.js'
export { classifyTier, TIER_PRIORITY } from './tiers.js'
export type { KBTier, KBTierSource } from './tiers.js'
export { calculateStaleness, STALENESS_THRESHOLDS } from './staleness.js'
export type { StalenessLevel, StalenessInfo } from './staleness.js'
