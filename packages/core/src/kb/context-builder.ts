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

// --- Anchor-aware truncation for KB digest ---

/** Keep sections matching high-value headings; truncate middle. */
function anchorAwareTruncate(content: string, charBudget: number): string {
  if (content.length <= charBudget) return content

  const anchorPatterns = /^#+\s*(STATUS|OPEN\s*GAPS?|DEADLINE|PRIORITIES|NEXT\s*ACTIONS?|OVERDUE|CRITICAL)/im
  const lines = content.split('\n')
  const kept: string[] = []
  let keptChars = 0
  let inAnchorSection = false

  for (const line of lines) {
    const isHeading = /^#+\s/.test(line)
    if (isHeading) {
      inAnchorSection = anchorPatterns.test(line)
    }

    if (inAnchorSection || kept.length < 5) {
      // Always keep first 5 lines (title/metadata) + anchor sections
      if (keptChars + line.length + 1 > charBudget - 20) {
        kept.push('...[TRUNCATED]')
        break
      }
      kept.push(line)
      keptChars += line.length + 1
    }
  }

  // If anchor strategy kept nothing useful, fallback to first X + last Y
  if (kept.length <= 6) {
    const firstChunk = Math.floor(charBudget * 0.7)
    const lastChunk = charBudget - firstChunk - 20
    if (lastChunk > 0) {
      return content.slice(0, firstChunk) + '\n...[TRUNCATED]...\n' + content.slice(content.length - lastChunk)
    }
    return content.slice(0, charBudget - 15) + '\n...[TRUNCATED]'
  }

  return kept.join('\n')
}

/**
 * Build KB context with ONLY the kb_digest.md file.
 * For ollama_fast profile: maximum domain knowledge in minimal tokens.
 */
export async function buildKBContextDigestOnly(
  kbPath: string,
  files: KBFile[],
  tokenBudget: number,
): Promise<Result<KBContext, DomainOSError>> {
  try {
    const charBudget = tokenBudget * 4
    const digestFile = files.find(f =>
      f.relativePath.toLowerCase() === 'kb_digest.md',
    )

    if (!digestFile) {
      return Ok({ files: [], totalChars: 0, truncated: false })
    }

    const absPath = join(kbPath, digestFile.relativePath)
    let content: string
    try {
      content = await readFile(absPath, 'utf-8')
    } catch {
      return Ok({ files: [], totalChars: 0, truncated: false })
    }

    let fileStat
    try {
      fileStat = await stat(absPath)
    } catch {
      return Ok({ files: [], totalChars: 0, truncated: false })
    }

    const tier = digestFile.tierSource === 'manual' && digestFile.tier
      ? (digestFile.tier as KBTier)
      : classifyTier(digestFile.relativePath)
    const staleness = calculateStaleness(fileStat.mtimeMs, undefined, tier)
    const stalenessLabel = formatStalenessLabel(staleness)

    let truncated = false
    if (content.length > charBudget) {
      content = anchorAwareTruncate(content, charBudget)
      truncated = true
    }

    const resultFiles: KBContextFile[] = [{
      path: digestFile.relativePath,
      content,
      tier,
      stalenessLabel,
    }]

    return Ok({ files: resultFiles, totalChars: content.length, truncated })
  } catch (err) {
    return Err(
      DomainOSError.io(
        `Failed to build digest-only KB context: ${err instanceof Error ? err.message : String(err)}`,
      ),
    )
  }
}

/**
 * Build KB context with kb_digest.md + structural content from claude.md.
 * For ollama_balanced profile: digest + domain identity/purpose.
 */
export async function buildKBContextDigestPlusStructural(
  kbPath: string,
  files: KBFile[],
  tokenBudget: number,
): Promise<Result<KBContext, DomainOSError>> {
  try {
    const charBudget = tokenBudget * 4
    const resultFiles: KBContextFile[] = []
    let totalChars = 0
    let truncated = false

    // 1. Include kb_digest.md first (priority)
    const digestFile = files.find(f =>
      f.relativePath.toLowerCase() === 'kb_digest.md',
    )

    if (digestFile) {
      const absPath = join(kbPath, digestFile.relativePath)
      try {
        let content = await readFile(absPath, 'utf-8')
        const fileStat = await stat(absPath)
        const tier = digestFile.tierSource === 'manual' && digestFile.tier
          ? (digestFile.tier as KBTier)
          : classifyTier(digestFile.relativePath)
        const staleness = calculateStaleness(fileStat.mtimeMs, undefined, tier)
        const stalenessLabel = formatStalenessLabel(staleness)

        // Reserve 35% of budget for claude.md structural content
        const digestBudget = Math.floor(charBudget * 0.65)
        if (content.length > digestBudget) {
          content = anchorAwareTruncate(content, digestBudget)
          truncated = true
        }

        resultFiles.push({ path: digestFile.relativePath, content, tier, stalenessLabel })
        totalChars += content.length
      } catch {
        // digest not readable — continue to claude.md
      }
    }

    // 2. Include claude.md structural content
    const claudeFile = files.find(f => {
      const lower = f.relativePath.toLowerCase()
      return lower === 'claude.md' || lower === 'claude.md'
    })

    if (claudeFile) {
      const absPath = join(kbPath, claudeFile.relativePath)
      try {
        const rawContent = await readFile(absPath, 'utf-8')
        const fileStat = await stat(absPath)
        const tier = claudeFile.tierSource === 'manual' && claudeFile.tier
          ? (claudeFile.tier as KBTier)
          : classifyTier(claudeFile.relativePath)
        const staleness = calculateStaleness(fileStat.mtimeMs, undefined, tier)
        const stalenessLabel = formatStalenessLabel(staleness)

        const remaining = charBudget - totalChars
        if (remaining > 200) {
          // Structural parse: keep content up to first non-identity heading
          let content = extractStructuralContent(rawContent, remaining)
          if (content.length > remaining) {
            content = content.slice(0, remaining - 15) + '\n...[TRUNCATED]'
            truncated = true
          }
          resultFiles.push({ path: claudeFile.relativePath, content, tier, stalenessLabel })
          totalChars += content.length
        }
      } catch {
        // claude.md not readable
      }
    }

    return Ok({ files: resultFiles, totalChars, truncated })
  } catch (err) {
    return Err(
      DomainOSError.io(
        `Failed to build digest+structural KB context: ${err instanceof Error ? err.message : String(err)}`,
      ),
    )
  }
}

/** Extract structural/identity content from claude.md up to first non-identity heading. */
function extractStructuralContent(content: string, maxChars: number): string {
  const lines = content.split('\n')
  const result: string[] = []
  let totalChars = 0
  let pastFirstHeading = false
  const nonIdentityPattern = /^##\s+(protocol|workflow|procedure|checklist|task|format|rule)/i

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (pastFirstHeading && nonIdentityPattern.test(line)) {
        break // Stop at first procedural heading
      }
      pastFirstHeading = true
    }

    if (totalChars + line.length + 1 > maxChars) {
      break
    }
    result.push(line)
    totalChars += line.length + 1
  }

  // Fallback: if we got very little, just take first maxChars
  if (result.length < 3 && content.length > 0) {
    return content.slice(0, Math.min(maxChars, 1500))
  }

  return result.join('\n')
}
