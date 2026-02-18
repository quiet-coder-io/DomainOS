/**
 * Parses STOP blocks from LLM response text.
 *
 * Format:
 * ```stop
 * reason: <why the agent is stopping>
 * action_needed: <what the user needs to do>
 * ```
 */

export interface ParsedStop {
  reason: string
  actionNeeded: string
}

export function parseStopBlocks(text: string): ParsedStop[] {
  if (!text) return []

  const stops: ParsedStop[] = []
  const blockRegex = /```stop\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const blockContent = match[1]

    const reasonMatch = blockContent.match(/^reason:\s*(.+)$/m)
    const actionMatch = blockContent.match(/^action_needed:\s*(.+)$/m)

    // reason is required
    if (!reasonMatch) continue

    stops.push({
      reason: reasonMatch[1].trim(),
      actionNeeded: actionMatch ? actionMatch[1].trim() : '',
    })
  }

  return stops
}
