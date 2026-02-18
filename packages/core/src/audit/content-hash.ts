/**
 * Compute content hash for audit deduplication.
 * SHA-256 of (filePath + "\n" + content).
 */

import { createHash } from 'node:crypto'

export function computeContentHash(filePath: string, content: string): string {
  return createHash('sha256')
    .update(filePath + '\n' + content)
    .digest('hex')
}
