/**
 * Skill import/export — .skill.md format with frontmatter + optional outputSchema fenced block.
 */

import { CreateSkillInputSchema } from './schemas.js'
import type { Skill, CreateSkillInput } from './schemas.js'

/**
 * Serialize a skill to the .skill.md markdown format.
 *
 * Format:
 * ---
 * name: "Skill Name"
 * description: "Description"
 * outputFormat: "freeform"
 * toolHints: ["tool1", "tool2"]
 * ---
 *
 * ```outputSchema
 * { ... }
 * ```
 *
 * Content body here...
 */
export function skillToMarkdown(skill: Skill): string {
  const lines: string[] = []

  // Frontmatter
  lines.push('---')
  lines.push(`name: ${JSON.stringify(skill.name)}`)
  if (skill.description) {
    lines.push(`description: ${JSON.stringify(skill.description)}`)
  }
  lines.push(`outputFormat: ${JSON.stringify(skill.outputFormat)}`)
  if (skill.toolHints.length > 0) {
    lines.push(`toolHints: ${JSON.stringify(skill.toolHints)}`)
  }
  lines.push('---')
  lines.push('')

  // Optional outputSchema fenced block
  if (skill.outputFormat === 'structured' && skill.outputSchema) {
    lines.push('```outputSchema')
    lines.push(skill.outputSchema)
    lines.push('```')
    lines.push('')
  }

  // Skill content body
  lines.push(skill.content)

  return lines.join('\n')
}

/**
 * Parse a .skill.md markdown string into a CreateSkillInput.
 * Uses line-by-line scanning (not string.split('---')) to handle content containing '---'.
 */
export function markdownToSkillInput(markdown: string): CreateSkillInput {
  const lines = markdown.split('\n')

  // Step 1: Find frontmatter delimiters
  let firstDelim = -1
  let secondDelim = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (firstDelim === -1) {
        firstDelim = i
      } else {
        secondDelim = i
        break
      }
    }
  }

  if (firstDelim === -1 || secondDelim === -1) {
    throw new Error('Invalid skill markdown: missing frontmatter delimiters (---)')
  }

  // Step 2: Parse frontmatter (key: JSON-value per line)
  const frontmatter: Record<string, unknown> = {}
  for (let i = firstDelim + 1; i < secondDelim; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 1).trim()
    try {
      frontmatter[key] = JSON.parse(rawValue)
    } catch {
      // If not valid JSON, treat as plain string
      frontmatter[key] = rawValue
    }
  }

  // Step 3: Scan for optional outputSchema fenced block
  let outputSchema: string | null = null
  let bodyStartLine = secondDelim + 1

  for (let i = secondDelim + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Skip empty lines between frontmatter and content/block
    if (!trimmed) continue

    if (trimmed === '```outputSchema') {
      // Find closing fence
      const blockStart = i + 1
      let blockEnd = -1
      for (let j = blockStart; j < lines.length; j++) {
        if (lines[j].trim() === '```') {
          blockEnd = j
          break
        }
      }
      if (blockEnd === -1) {
        throw new Error('Invalid skill markdown: unclosed outputSchema block')
      }
      outputSchema = lines.slice(blockStart, blockEnd).join('\n')
      bodyStartLine = blockEnd + 1
      break
    } else {
      // First non-empty, non-fence line = start of content
      bodyStartLine = i
      break
    }
  }

  // Step 4: Everything after is the skill content
  // Trim leading empty lines from body
  while (bodyStartLine < lines.length && lines[bodyStartLine].trim() === '') {
    bodyStartLine++
  }
  const content = lines.slice(bodyStartLine).join('\n').trimEnd()

  if (!content) {
    throw new Error('Invalid skill markdown: no content body found')
  }

  // Step 5: Build and validate via schema
  const input: CreateSkillInput = {
    name: (frontmatter.name as string) ?? '',
    description: (frontmatter.description as string) ?? '',
    content,
    outputFormat: (frontmatter.outputFormat as 'freeform' | 'structured') ?? 'freeform',
    outputSchema: outputSchema,
    toolHints: (frontmatter.toolHints as string[]) ?? [],
  }

  const result = CreateSkillInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(`Invalid skill markdown: ${result.error.message}`)
  }

  return input
}
