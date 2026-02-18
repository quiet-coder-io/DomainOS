/**
 * Session startup report — assembles staleness warnings and open gap flags
 * into a context string for the === SESSION === prompt section.
 */

import type { StalenessInfo } from '../kb/staleness.js'
import type { SessionScope } from './schemas.js'

export interface StartupFileInfo {
  path: string
  staleness: StalenessInfo
}

export interface GapFlagSummary {
  category: string
  description: string
}

export function buildStartupReport(
  scope: SessionScope,
  staleFiles: StartupFileInfo[],
  openGapFlags: GapFlagSummary[],
): string {
  const sections: string[] = []

  sections.push(`Session scope: ${scope}`)

  // Stale file warnings
  const staleOrCritical = staleFiles.filter((f) => f.staleness.level !== 'fresh')
  if (staleOrCritical.length > 0) {
    sections.push('')
    sections.push('--- Stale Files ---')
    for (const file of staleOrCritical) {
      const label =
        file.staleness.level === 'critical'
          ? `CRITICALLY STALE (${file.staleness.daysSinceUpdate} days)`
          : `STALE (${file.staleness.daysSinceUpdate} days)`
      sections.push(`- ${file.path}: ${label}`)
    }
  }

  // Open gap flags
  if (openGapFlags.length > 0) {
    sections.push('')
    sections.push('--- Open Gap Flags ---')
    for (const gap of openGapFlags) {
      sections.push(`- [${gap.category}] ${gap.description}`)
    }
  }

  return sections.join('\n')
}
