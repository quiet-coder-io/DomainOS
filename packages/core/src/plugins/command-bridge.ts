/**
 * Command bridge — parse a plugin's command markdown file into a
 * CreateCommandInput compatible with the plugin command schema.
 */

import { createHash } from 'node:crypto'
import type { CreateCommandInput } from './schemas.js'

export interface ParsedPluginCommand {
  name: string
  description: string
  argumentHint: string | null
  canonicalSlug: string
  pluginCommandKey: string
  sourceContent: string
  sourceHash: string
  content: string
  sourceRef: string | null
  sourcePath: string | null
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

/** Convert a filename (without extension) to Title Case. */
function toTitleCase(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Convert a filename (without extension) to kebab-case. */
function toKebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2') // camelCase boundaries
    .replace(/[\s_]+/g, '-') // spaces and underscores to hyphens
    .replace(/[^a-zA-Z0-9-]/g, '') // strip non-alphanumeric (except hyphens)
    .replace(/-+/g, '-') // collapse multiple hyphens
    .toLowerCase()
}

/** Extract the basename without extension from a file path. */
function basenameNoExt(filePath: string): string {
  const segments = filePath.split(/[/\\]/)
  const filename = segments[segments.length - 1] || ''
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.slice(0, dotIdx) : filename
}

/**
 * Parse a plugin's command markdown file into a ParsedPluginCommand.
 *
 * Reads frontmatter for metadata (name, description, argument_hint).
 * Falls back to filename-derived name if not in frontmatter.
 */
export function parsePluginCommand(
  filePath: string,
  rawContent: string,
  opts: { pluginName: string; sourceRef?: string; sourcePath?: string },
): ParsedPluginCommand {
  const { meta, body } = parseFrontmatter(rawContent)

  const stem = basenameNoExt(filePath)
  const name = meta['name'] || toTitleCase(stem)
  const description = meta['description'] || ''
  const argumentHint = meta['argument_hint'] || null

  const commandSlug = toKebabCase(stem)
  const canonicalSlug = `${opts.pluginName}:${commandSlug}`
  const pluginCommandKey = commandSlug

  const content = body.trim()
  const sourceHash = createHash('sha256').update(rawContent).digest('hex')

  return {
    name,
    description,
    argumentHint,
    canonicalSlug,
    pluginCommandKey,
    sourceContent: rawContent,
    sourceHash,
    content,
    sourceRef: opts.sourceRef ?? null,
    sourcePath: opts.sourcePath ?? null,
  }
}
