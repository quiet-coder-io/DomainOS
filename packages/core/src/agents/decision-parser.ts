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
 * confidence: high | medium | low
 * horizon: immediate | near_term | strategic
 * reversibility_class: reversible | irreversible
 * reversibility_notes: <free text>
 * category: strategic | tactical | operational
 * ```
 */

import { validateEnum } from '../advisory/normalize.js'

export interface ParsedDecision {
  decisionId: string
  decision: string
  rationale: string
  downside: string
  revisitTrigger: string
  linkedFiles: string[]
  confidence: string | null
  horizon: string | null
  reversibilityClass: string | null
  reversibilityNotes: string | null
  category: string | null
}

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const
const HORIZON_VALUES = ['immediate', 'near_term', 'strategic'] as const
const REVERSIBILITY_VALUES = ['reversible', 'irreversible'] as const
const CATEGORY_VALUES = ['strategic', 'tactical', 'operational'] as const

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
    const confidenceMatch = blockContent.match(/^confidence:\s*(.+)$/m)
    const horizonMatch = blockContent.match(/^horizon:\s*(.+)$/m)
    const reversibilityMatch = blockContent.match(/^reversibility_class:\s*(.+)$/m)
    const reversibilityNotesMatch = blockContent.match(/^reversibility_notes:\s*(.+)$/m)
    const categoryMatch = blockContent.match(/^category:\s*(.+)$/m)

    const linkedFiles = linkedMatch
      ? linkedMatch[1]
          .trim()
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
      : []

    const confidence = confidenceMatch
      ? validateEnum(confidenceMatch[1].trim(), CONFIDENCE_VALUES, 'confidence', 'decision', '').value
      : null
    const horizon = horizonMatch
      ? validateEnum(horizonMatch[1].trim(), HORIZON_VALUES, 'horizon', 'decision', '').value
      : null
    const reversibilityClass = reversibilityMatch
      ? validateEnum(reversibilityMatch[1].trim(), REVERSIBILITY_VALUES, 'reversibility_class', 'decision', '').value
      : null
    const category = categoryMatch
      ? validateEnum(categoryMatch[1].trim(), CATEGORY_VALUES, 'category', 'decision', '').value
      : null

    decisions.push({
      decisionId: idMatch[1].trim(),
      decision: decisionMatch[1].trim(),
      rationale: rationaleMatch ? rationaleMatch[1].trim() : '',
      downside: downsideMatch ? downsideMatch[1].trim() : '',
      revisitTrigger: revisitMatch ? revisitMatch[1].trim() : '',
      linkedFiles,
      confidence,
      horizon,
      reversibilityClass,
      reversibilityNotes: reversibilityNotesMatch ? reversibilityNotesMatch[1].trim() : null,
      category,
    })
  }

  return decisions
}
