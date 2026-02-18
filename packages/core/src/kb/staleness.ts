/**
 * KB file staleness tracking.
 * Layered staleness basis: file mtime as primary, lastSemanticUpdateAt as fallback.
 * Tier-specific thresholds determine when files are considered stale or critical.
 */

import type { KBTier } from './tiers.js'

export type StalenessLevel = 'fresh' | 'stale' | 'critical'

export interface StalenessInfo {
  level: StalenessLevel
  daysSinceUpdate: number
  basis: 'mtime' | 'semantic'
}

/**
 * Staleness thresholds in days, keyed by tier.
 * structural: long-lived config, 30 days before stale
 * status: frequently updated digest, 7 days before stale
 * intelligence/general: moderate frequency, 14 days before stale
 */
export const STALENESS_THRESHOLDS: Record<KBTier, { stale: number; critical: number }> = {
  structural: { stale: 30, critical: 90 },
  status: { stale: 7, critical: 21 },
  intelligence: { stale: 14, critical: 45 },
  general: { stale: 14, critical: 45 },
}

const MS_PER_DAY = 86_400_000

/**
 * Calculate staleness for a KB file.
 * Uses mtime as primary basis; falls back to lastSemanticUpdateAt if provided.
 * lastSemanticUpdateAt is only updated on actual content changes via kb:apply-update,
 * not on background sync events.
 */
export function calculateStaleness(
  mtimeMs: number,
  lastSemanticUpdateAt: string | undefined,
  tier: KBTier,
): StalenessInfo {
  const now = Date.now()

  // Determine the most relevant timestamp
  let referenceMs = mtimeMs
  let basis: StalenessInfo['basis'] = 'mtime'

  if (lastSemanticUpdateAt) {
    const semanticMs = new Date(lastSemanticUpdateAt).getTime()
    if (!isNaN(semanticMs)) {
      referenceMs = semanticMs
      basis = 'semantic'
    }
  }

  const daysSinceUpdate = Math.floor((now - referenceMs) / MS_PER_DAY)
  const thresholds = STALENESS_THRESHOLDS[tier]

  let level: StalenessLevel = 'fresh'
  if (daysSinceUpdate >= thresholds.critical) {
    level = 'critical'
  } else if (daysSinceUpdate >= thresholds.stale) {
    level = 'stale'
  }

  return { level, daysSinceUpdate, basis }
}
