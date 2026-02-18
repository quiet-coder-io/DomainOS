/**
 * Parses gap-flag blocks from LLM response text.
 *
 * Format:
 * ```gap-flag
 * category: <missing-context|outdated-info|conflicting-data|assumption-made|process-gap>
 * description: <what was identified as a gap>
 * ```
 */

export interface ParsedGapFlag {
  category: string
  description: string
}

export function parseGapFlags(text: string): ParsedGapFlag[] {
  if (!text) return []

  const flags: ParsedGapFlag[] = []
  const blockRegex = /```gap-flag\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const blockContent = match[1]

    const categoryMatch = blockContent.match(/^category:\s*(.+)$/m)
    const descriptionMatch = blockContent.match(/^description:\s*(.+)$/m)

    // Both fields required
    if (!categoryMatch || !descriptionMatch) continue

    flags.push({
      category: categoryMatch[1].trim(),
      description: descriptionMatch[1].trim(),
    })
  }

  return flags
}
