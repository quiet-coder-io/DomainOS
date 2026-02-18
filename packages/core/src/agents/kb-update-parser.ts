/**
 * Parses KB update proposals from LLM response text.
 * Supports the structured envelope format with tier, mode, and basis fields.
 */

import { classifyTier } from '../kb/tiers.js'
import type { KBTier } from '../kb/tiers.js'

export type KBUpdateMode = 'full' | 'append' | 'patch'
export type KBUpdateBasis = 'primary' | 'sibling' | 'external' | 'user'

export interface KBUpdateProposal {
  file: string
  action: 'create' | 'update' | 'delete'
  tier: KBTier
  mode: KBUpdateMode
  basis: KBUpdateBasis
  reasoning: string
  content: string
  confirm?: string
}

const VALID_ACTIONS = new Set(['create', 'update', 'delete'])
const VALID_MODES = new Set(['full', 'append', 'patch'])
const VALID_BASES = new Set(['primary', 'sibling', 'external', 'user'])

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

    const file = fileMatch[1].trim()

    // Optional fields with defaults
    const tierMatch = header.match(/^tier:\s*(.+)$/m)
    const modeMatch = header.match(/^mode:\s*(.+)$/m)
    const basisMatch = header.match(/^basis:\s*(.+)$/m)
    const confirmMatch = header.match(/^confirm:\s*(.+)$/m)

    // Infer tier from filename if not specified
    const tierValue = tierMatch ? tierMatch[1].trim() : classifyTier(file)
    const modeValue = modeMatch ? modeMatch[1].trim() : 'full'
    const basisValue = basisMatch ? basisMatch[1].trim() : 'primary'

    // Validate enums — fall back to defaults for invalid values
    const tier = (['structural', 'status', 'intelligence', 'general'].includes(tierValue)
      ? tierValue
      : classifyTier(file)) as KBTier
    const mode = (VALID_MODES.has(modeValue) ? modeValue : 'full') as KBUpdateMode
    const basis = (VALID_BASES.has(basisValue) ? basisValue : 'primary') as KBUpdateBasis

    // Validate tier write rules
    if (tier === 'structural' && mode !== 'patch') continue
    if (tier === 'status' && mode === 'patch') continue

    // Validate delete confirmation
    if (action === 'delete') {
      const confirmValue = confirmMatch ? confirmMatch[1].trim() : ''
      if (confirmValue !== `DELETE ${file}`) continue
    }

    proposals.push({
      file,
      action: action as 'create' | 'update' | 'delete',
      tier,
      mode,
      basis,
      reasoning: reasoningMatch[1].trim(),
      content: content.trimEnd(),
      confirm: confirmMatch ? confirmMatch[1].trim() : undefined,
    })
  }

  return proposals
}
