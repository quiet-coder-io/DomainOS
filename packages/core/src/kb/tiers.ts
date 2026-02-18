/**
 * KB file tier classification.
 * Files are classified by filename into tiers that determine
 * prompt ordering, staleness thresholds, and write mode rules.
 */

import { basename, dirname } from 'node:path'

export type KBTier = 'structural' | 'status' | 'intelligence' | 'general'
export type KBTierSource = 'inferred' | 'manual'

/** Lower number = higher priority in prompt ordering. */
export const TIER_PRIORITY: Record<KBTier, number> = {
  structural: 0,
  status: 1,
  intelligence: 2,
  general: 3,
}

const TIER_MAP: Record<string, KBTier> = {
  'claude.md': 'structural',
  'kb_digest.md': 'status',
  'kb_intel.md': 'intelligence',
}

/**
 * Classify a KB file into a tier based on its filename.
 * Case-insensitive match on the basename.
 * Only root-level files get named tiers (structural/status/intelligence);
 * nested files with the same name are classified as general to avoid
 * stale subdirectory files outranking the canonical root KB files.
 */
export function classifyTier(relativePath: string): KBTier {
  const dir = dirname(relativePath)
  if (dir !== '.') return 'general'
  const name = basename(relativePath).toLowerCase()
  return TIER_MAP[name] ?? 'general'
}
