/**
 * Skill bridge — parse a plugin's skill directory into a CreateSkillInput
 * compatible with the existing SkillRepository.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { EXTRACTION_LIMITS } from './schemas.js'
import type { AssetIndexEntry } from './schemas.js'

export interface ParsedPluginSkill {
  name: string
  description: string
  content: string
  outputFormat: 'freeform' | 'structured'
  outputSchema: string | null
  toolHints: string[]
  pluginSkillKey: string
  sourceContent: string
  sourceHash: string
  sourceRef: string | null
  sourcePath: string | null
  hasAssets: boolean
  assetsIndexJson: AssetIndexEntry[]
}

/** Simple frontmatter parser — splits on `---` and parses key: value pairs. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}

  if (!raw.startsWith('---')) {
    return { meta, body: raw }
  }

  const endIdx = raw.indexOf('\n---', 3)
  if (endIdx === -1) {
    return { meta, body: raw }
  }

  const frontmatterBlock = raw.slice(4, endIdx) // skip leading '---\n'
  const body = raw.slice(endIdx + 4).replace(/^\n/, '') // skip closing '---\n'

  for (const line of frontmatterBlock.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }

  return { meta, body }
}

/** Parse tool_hints from frontmatter value — handles comma-separated or JSON array syntax. */
function parseToolHints(raw: string | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()

  // Try JSON array first: ["a", "b"]
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean)
    } catch {
      // fall through to comma-split
    }
  }

  return trimmed.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Compute SHA-256 hex digest for a buffer or string. */
function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Parse a plugin's skill directory into a ParsedPluginSkill.
 *
 * Reads `SKILL.md` from `skillDir`, parses frontmatter for metadata,
 * and enumerates sibling files as assets.
 */
export async function parsePluginSkill(
  skillDir: string,
  opts?: { sourceRef?: string; sourcePath?: string; pluginSkillKey?: string },
): Promise<ParsedPluginSkill> {
  const skillMdPath = join(skillDir, 'SKILL.md')
  const rawContent = await readFile(skillMdPath, 'utf-8')

  const { meta, body } = parseFrontmatter(rawContent)

  const name = meta['name'] || ''
  if (!name) {
    throw new Error(`SKILL.md in ${skillDir} is missing required 'name' field in frontmatter`)
  }

  const description = meta['description'] || ''
  const outputFormat = meta['output_format'] === 'structured' ? 'structured' as const : 'freeform' as const
  const toolHints = parseToolHints(meta['tool_hints'])
  const content = body.trim()

  if (!content) {
    throw new Error(`SKILL.md in ${skillDir} has no content after frontmatter`)
  }

  // Enumerate sibling files for asset index
  const entries = await readdir(skillDir)
  const assetsIndexJson: AssetIndexEntry[] = []

  for (const entry of entries) {
    if (entry === 'SKILL.md') continue

    const ext = extname(entry).toLowerCase()
    if (!EXTRACTION_LIMITS.storageAllowedExts.has(ext)) continue

    const filePath = join(skillDir, entry)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) continue
    if (fileStat.size > EXTRACTION_LIMITS.maxSingleFileBytes) continue

    const fileBuffer = await readFile(filePath)
    const fileSha256 = sha256(fileBuffer)
    const llmSafe = EXTRACTION_LIMITS.llmSafeExts.has(ext) ? 1 as const : 0 as const

    assetsIndexJson.push({
      path: entry,
      sha256: fileSha256,
      size: fileStat.size,
      type: ext.slice(1), // strip leading dot
      llm_safe: llmSafe,
    })
  }

  const sourceHash = sha256(content)

  // Derive pluginSkillKey from opts or directory name
  const dirName = skillDir.split('/').pop() || skillDir.split('\\').pop() || 'unknown'
  const pluginSkillKey = opts?.pluginSkillKey || dirName

  return {
    name,
    description,
    content,
    outputFormat,
    outputSchema: null, // structured outputSchema would come from a separate file or frontmatter extension
    toolHints,
    pluginSkillKey,
    sourceContent: rawContent,
    sourceHash,
    sourceRef: opts?.sourceRef ?? null,
    sourcePath: opts?.sourcePath ?? null,
    hasAssets: assetsIndexJson.length > 0,
    assetsIndexJson,
  }
}
