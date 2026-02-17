/**
 * Knowledge base — structured document storage and retrieval.
 * Manages domain-specific knowledge files, digests, and change logs.
 */

export {
  KBFileSchema,
  KBScannedFileSchema,
  KBContextSchema,
  KBSyncResultSchema,
} from './schemas.js'
export type { KBFile, KBScannedFile, KBContext, KBSyncResult } from './schemas.js'

export { scanKBDirectory } from './scanner.js'
export { KBRepository } from './repository.js'
export { buildKBContext } from './context-builder.js'
