/**
 * Parses decision blocks from LLM response text.
 *
 * Format:
 * ```decision
 * decision_id: <short-kebab-case-id>
 * decision: <what was decided>
 * rationale: <why this was chosen>
 * downside: <known tradeoffs>
 * revisit_trigger: <when to reconsider>
 * linked_files: <comma-separated KB files affected>
 * ```
 */

export interface ParsedDecision {
  decisionId: string
  decision: string
  rationale: string
  downside: string
  revisitTrigger: string
  linkedFiles: string[]
}

export function parseDecisions(text: string): ParsedDecision[] {
  if (!text) return []

  const decisions: ParsedDecision[] = []
  const blockRegex = /```decision\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const blockContent = match[1]

    const idMatch = blockContent.match(/^decision_id:\s*(.+)$/m)
    const decisionMatch = blockContent.match(/^decision:\s*(.+)$/m)

    // decision_id and decision are required
    if (!idMatch || !decisionMatch) continue

    const rationaleMatch = blockContent.match(/^rationale:\s*(.+)$/m)
    const downsideMatch = blockContent.match(/^downside:\s*(.+)$/m)
    const revisitMatch = blockContent.match(/^revisit_trigger:\s*(.+)$/m)
    const linkedMatch = blockContent.match(/^linked_files:\s*(.+)$/m)

    const linkedFiles = linkedMatch
      ? linkedMatch[1]
          .trim()
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : []

    decisions.push({
      decisionId: idMatch[1].trim(),
      decision: decisionMatch[1].trim(),
      rationale: rationaleMatch ? rationaleMatch[1].trim() : '',
      downside: downsideMatch ? downsideMatch[1].trim() : '',
      revisitTrigger: revisitMatch ? revisitMatch[1].trim() : '',
      linkedFiles,
    })
  }

  return decisions
}
