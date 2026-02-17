/**
 * Parses KB update proposals from LLM response text.
 */

export interface KBUpdateProposal {
  file: string
  action: 'create' | 'update' | 'delete'
  reasoning: string
  content: string
}

const VALID_ACTIONS = new Set(['create', 'update', 'delete'])

export function parseKBUpdates(text: string): KBUpdateProposal[] {
  if (!text) return []

  const proposals: KBUpdateProposal[] = []
  const blockRegex = /```kb-update\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const blockContent = match[1]
    const separatorIndex = blockContent.indexOf('\n---\n')

    if (separatorIndex === -1) continue

    const header = blockContent.slice(0, separatorIndex)
    const content = blockContent.slice(separatorIndex + 5) // skip '\n---\n'

    const fileMatch = header.match(/^file:\s*(.+)$/m)
    const actionMatch = header.match(/^action:\s*(.+)$/m)
    const reasoningMatch = header.match(/^reasoning:\s*(.+)$/m)

    if (!fileMatch || !actionMatch || !reasoningMatch) continue

    const action = actionMatch[1].trim()
    if (!VALID_ACTIONS.has(action)) continue

    proposals.push({
      file: fileMatch[1].trim(),
      action: action as 'create' | 'update' | 'delete',
      reasoning: reasoningMatch[1].trim(),
      content: content.trimEnd(),
    })
  }

  return proposals
}
