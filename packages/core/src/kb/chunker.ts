/**
 * Heading-aware markdown chunker with stable content-anchored identity.
 * Splits markdown files into chunks at heading boundaries, tracks heading paths,
 * and generates stable chunk keys that survive heading insertion/reordering.
 */

import { createHash } from 'node:crypto'
import { estimateTokens } from '../agents/token-budgets.js'

export interface ChunkerOptions {
  maxChunkChars?: number
  minChunkChars?: number
  overlapChars?: number
}

export interface KBChunkData {
  chunkIndex: number
  chunkKey: string
  headingPath: string
  content: string
  contentHash: string
  charCount: number
  tokenEstimate: number
  startLine: number | null
  endLine: number | null
}

const DEFAULT_MAX_CHUNK_CHARS = 1500
const DEFAULT_MIN_CHUNK_CHARS = 100
const DEFAULT_OVERLAP_CHARS = 200

const HEADING_RE = /^(#{1,6})\s+(.*)$/

/**
 * Normalize content for stable anchor hashing.
 * - Normalize line endings to \n
 * - Strip the heading line itself
 * - Trim leading/trailing whitespace
 * - Collapse whitespace runs to single space (except inside fenced code blocks)
 * - Keep punctuation and case
 */
export function normalizeForAnchor(content: string, headingLine?: string): string {
  let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Strip the heading line itself from anchor input
  if (headingLine) {
    const idx = text.indexOf(headingLine)
    if (idx !== -1) {
      text = text.slice(0, idx) + text.slice(idx + headingLine.length)
    }
  }

  text = text.trim()

  // Collapse whitespace runs to single space, but preserve indentation inside fenced code blocks
  const lines = text.split('\n')
  const parts: string[] = []
  let inCodeBlock = false
  let codeBlockLines: string[] = []
  let textLines: string[] = []

  const flushText = (): void => {
    if (textLines.length > 0) {
      parts.push(textLines.join(' ').replace(/\s+/g, ' '))
      textLines = []
    }
  }

  const flushCode = (): void => {
    if (codeBlockLines.length > 0) {
      parts.push(codeBlockLines.join('\n'))
      codeBlockLines = []
    }
  }

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inCodeBlock) {
        flushText()
        codeBlockLines.push(line)
      } else {
        codeBlockLines.push(line)
        flushCode()
      }
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) {
      codeBlockLines.push(line)
    } else {
      textLines.push(line)
    }
  }
  flushText()
  flushCode()

  return parts.join(' ').trim()
}

function computeChunkKey(fileId: string, headingPath: string, content: string, headingLine?: string): string {
  const normalized = normalizeForAnchor(content, headingLine)
  const anchorInput = headingPath + '\n' + normalized.slice(0, 256)
  const anchorHash = createHash('sha256').update(anchorInput).digest('hex')
  return createHash('sha256').update(fileId + headingPath + anchorHash).digest('hex')
}

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

interface RawSection {
  headingPath: string
  headingLine: string | undefined
  content: string
  startLine: number
  endLine: number
  headingLevel: number
}

/**
 * Parse a markdown file into heading-delimited sections.
 * Tracks heading hierarchy path (e.g., "## Status > ### Open Items").
 */
function parseIntoSections(content: string): RawSection[] {
  const lines = content.split('\n')
  const sections: RawSection[] = []
  const headingStack: Array<{ level: number; text: string }> = []

  let currentContent: string[] = []
  let currentStartLine = 0
  let currentHeadingLine: string | undefined
  let currentHeadingLevel = 0
  let isFrontmatter = false
  let hasFrontmatter = false

  // Detect YAML frontmatter
  if (lines.length > 0 && lines[0].trim() === '---') {
    isFrontmatter = true
    hasFrontmatter = true
    currentContent.push(lines[0])

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        currentContent.push(lines[i])
        sections.push({
          headingPath: '[frontmatter]',
          headingLine: undefined,
          content: currentContent.join('\n'),
          startLine: 0,
          endLine: i,
          headingLevel: 0,
        })
        currentContent = []
        currentStartLine = i + 1
        isFrontmatter = false
        break
      }
      currentContent.push(lines[i])
    }

    // If frontmatter never closed, treat whole thing as frontmatter
    if (isFrontmatter) {
      sections.push({
        headingPath: '[frontmatter]',
        headingLine: undefined,
        content: currentContent.join('\n'),
        startLine: 0,
        endLine: lines.length - 1,
        headingLevel: 0,
      })
      return sections
    }
  }

  const startIdx = hasFrontmatter ? sections[0].endLine + 1 : 0
  currentContent = []
  currentStartLine = startIdx

  function buildHeadingPath(): string {
    return headingStack.map(h => `${'#'.repeat(h.level)} ${h.text}`).join(' > ')
  }

  function flushCurrentSection(endLine: number): void {
    const text = currentContent.join('\n').trim()
    if (text.length > 0) {
      sections.push({
        headingPath: buildHeadingPath(),
        headingLine: currentHeadingLine,
        content: currentContent.join('\n'),
        startLine: currentStartLine,
        endLine,
        headingLevel: currentHeadingLevel,
      })
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const match = HEADING_RE.exec(lines[i])
    if (match) {
      // Flush previous section
      flushCurrentSection(i - 1)

      const level = match[1].length
      const text = match[2].trim()

      // Pop headings at same or deeper level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }
      headingStack.push({ level, text })

      currentContent = [lines[i]]
      currentStartLine = i
      currentHeadingLine = lines[i]
      currentHeadingLevel = level
    } else {
      currentContent.push(lines[i])
    }
  }

  // Flush remaining
  flushCurrentSection(lines.length - 1)

  return sections
}

/**
 * Split a large section into fixed-size sub-chunks with overlap.
 */
function splitLargeSection(
  section: RawSection,
  maxChars: number,
  overlapChars: number,
): RawSection[] {
  const content = section.content
  if (content.length <= maxChars) return [section]

  const chunks: RawSection[] = []

  let offset = 0
  while (offset < content.length) {
    const end = Math.min(offset + maxChars, content.length)
    const chunkContent = content.slice(offset, end)

    // Approximate line numbers
    const charsBeforeOffset = content.slice(0, offset).split('\n').length - 1
    const chunkLines = chunkContent.split('\n').length - 1

    chunks.push({
      headingPath: section.headingPath,
      headingLine: offset === 0 ? section.headingLine : undefined,
      content: chunkContent,
      startLine: section.startLine + charsBeforeOffset,
      endLine: section.startLine + charsBeforeOffset + chunkLines,
      headingLevel: section.headingLevel,
    })

    offset = end - overlapChars
    if (offset >= content.length) break
    if (end === content.length) break
  }

  return chunks
}

/**
 * Chunk a markdown file into heading-aware sections with stable identity.
 */
export function chunkMarkdownFile(
  fileId: string,
  content: string,
  options?: ChunkerOptions,
): KBChunkData[] {
  const maxChunkChars = options?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  const minChunkChars = options?.minChunkChars ?? DEFAULT_MIN_CHUNK_CHARS
  const overlapChars = options?.overlapChars ?? DEFAULT_OVERLAP_CHARS

  if (!content || content.trim().length === 0) {
    return []
  }

  const rawSections = parseIntoSections(content)

  // Merge small sections with next section
  const merged: RawSection[] = []
  for (let i = 0; i < rawSections.length; i++) {
    const section = rawSections[i]
    if (section.content.trim().length < minChunkChars && i + 1 < rawSections.length) {
      // Merge into next section
      const next = rawSections[i + 1]
      rawSections[i + 1] = {
        ...next,
        content: section.content + '\n' + next.content,
        startLine: section.startLine,
        headingLine: next.headingLine,
      }
    } else {
      merged.push(section)
    }
  }

  // Split large sections
  const finalSections: RawSection[] = []
  for (const section of merged) {
    const split = splitLargeSection(section, maxChunkChars, overlapChars)
    finalSections.push(...split)
  }

  // Convert to KBChunkData
  const chunks: KBChunkData[] = []
  for (let i = 0; i < finalSections.length; i++) {
    const section = finalSections[i]
    const trimmedContent = section.content.trim()
    if (trimmedContent.length === 0) continue

    const chunkKey = computeChunkKey(fileId, section.headingPath, section.content, section.headingLine)
    const contentHash = computeContentHash(trimmedContent)

    chunks.push({
      chunkIndex: i,
      chunkKey,
      headingPath: section.headingPath,
      content: trimmedContent,
      contentHash,
      charCount: trimmedContent.length,
      tokenEstimate: estimateTokens(trimmedContent.length),
      startLine: section.startLine,
      endLine: section.endLine,
    })
  }

  return chunks
}
