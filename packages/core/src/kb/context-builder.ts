/**
 * KB context builder — assembles file contents into a token-budgeted context.
 * Sorts by tier priority → staleness severity → path alphabetical.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { KBFile, KBContext, KBContextFile } from './schemas.js'
import { classifyTier, TIER_PRIORITY } from './tiers.js'
import type { KBTier } from './tiers.js'
import { calculateStaleness } from './staleness.js'
import type { StalenessInfo } from './staleness.js'

interface FileWithMeta {
  file: KBFile
  mtimeMs: number
  tier: KBTier
  staleness: StalenessInfo
}

/**
 * Staleness severity for sorting: critical > stale > fresh.
 * Higher number = more urgent = should appear earlier in context.
 */
function stalenessSortValue(level: StalenessInfo['level']): number {
  switch (level) {
    case 'critical': return 2
    case 'stale': return 1
    case 'fresh': return 0
  }
}

function formatStalenessLabel(staleness: StalenessInfo): string {
  switch (staleness.level) {
    case 'fresh': return '[FRESH]'
    case 'stale': return `[STALE - ${staleness.daysSinceUpdate} days]`
    case 'critical': return `[CRITICALLY STALE - ${staleness.daysSinceUpdate} days]`
  }
}

export async function buildKBContext(
  kbPath: string,
  files: KBFile[],
  tokenBudget: number,
): Promise<Result<KBContext, DomainOSError>> {
  try {
    const charBudget = tokenBudget * 4

    // Stat all files to get mtime and compute tier + staleness
    const filesWithMeta: FileWithMeta[] = []
    for (const file of files) {
      try {
        const absPath = join(kbPath, file.relativePath)
        const fileStat = await stat(absPath)
        const tier = file.tierSource === 'manual' && file.tier
          ? (file.tier as KBTier)
          : classifyTier(file.relativePath)
        const staleness = calculateStaleness(fileStat.mtimeMs, undefined, tier)
        filesWithMeta.push({ file, mtimeMs: fileStat.mtimeMs, tier, staleness })
      } catch {
        // Skip files that can't be stat'd (deleted since scan)
        continue
      }
    }

    // Deterministic sort: tier priority → staleness severity (desc) → path alphabetical
    filesWithMeta.sort((a, b) => {
      const tierDiff = TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier]
      if (tierDiff !== 0) return tierDiff

      const stalenessDiff = stalenessSortValue(b.staleness.level) - stalenessSortValue(a.staleness.level)
      if (stalenessDiff !== 0) return stalenessDiff

      return a.file.relativePath.localeCompare(b.file.relativePath)
    })

    const resultFiles: KBContextFile[] = []
    let totalChars = 0
    let truncated = false

    for (const { file, staleness, tier } of filesWithMeta) {
      const absPath = join(kbPath, file.relativePath)
      let content: string
      try {
        content = await readFile(absPath, 'utf-8')
      } catch {
        continue
      }

      const tierLabel = `[${tier.toUpperCase()}]`
      const stalenessLabel = formatStalenessLabel(staleness)
      const header = `--- ${tierLabel} ${stalenessLabel} ${file.relativePath} ---\n`
      const block = header + content
      const blockChars = block.length

      if (totalChars + blockChars > charBudget) {
        // Truncate last file to fit remaining budget
        const remaining = charBudget - totalChars - header.length
        if (remaining > 50) {
          const truncatedContent = content.slice(0, remaining) + '\n...[TRUNCATED]'
          resultFiles.push({
            path: file.relativePath,
            content: truncatedContent,
            tier,
            stalenessLabel,
          })
          totalChars += header.length + truncatedContent.length
        }
        truncated = true
        break
      }

      resultFiles.push({
        path: file.relativePath,
        content,
        tier,
        stalenessLabel,
      })
      totalChars += blockChars
    }

    return Ok({ files: resultFiles, totalChars, truncated })
  } catch (err) {
    return Err(
      DomainOSError.io(
        `Failed to build KB context: ${err instanceof Error ? err.message : String(err)}`,
      ),
    )
  }
}

/**
 * Build sibling domain context from their KB_DIGEST files.
 * Enforces per-sibling and global token caps.
 */
export async function buildSiblingContext(
  siblings: Array<{ domainName: string; kbPath: string }>,
  perSiblingTokenCap: number,
  globalTokenCap: number,
): Promise<Array<{ domainName: string; digestContent: string }>> {
  const perSiblingCharCap = perSiblingTokenCap * 4
  const globalCharCap = globalTokenCap * 4
  const results: Array<{ domainName: string; digestContent: string }> = []
  let totalChars = 0

  for (const sibling of siblings) {
    const digestPath = join(sibling.kbPath, 'kb_digest.md')
    let content: string
    try {
      content = await readFile(digestPath, 'utf-8')
    } catch {
      // No digest file — skip this sibling
      continue
    }

    // Per-sibling truncation
    if (content.length > perSiblingCharCap) {
      content = content.slice(0, perSiblingCharCap) + '\n...[TRUNCATED]'
    }

    // Global cap check — drop entire sibling if it would exceed
    if (totalChars + content.length > globalCharCap) {
      break
    }

    results.push({ domainName: sibling.domainName, digestContent: content })
    totalChars += content.length
  }

  return results
}
