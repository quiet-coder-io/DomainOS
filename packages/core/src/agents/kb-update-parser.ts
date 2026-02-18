/**
 * Parses KB update proposals from LLM response text.
 * Supports the structured envelope format with tier, mode, and basis fields.
 * Returns both valid proposals and rejected proposals with reasons.
 */

import { isAbsolute } from 'node:path'
import { win32, posix } from 'node:path'
import { classifyTier } from '../kb/tiers.js'
import type { KBTier } from '../kb/tiers.js'
import { fnv1aHash } from '../common/hash.js'

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

export interface RejectedProposal {
  id: string
  file: string
  action: string
  reasoning: string
  rejectionReason: string
  suggestedFix?: string
  tier?: string
  mode?: string
  rawExcerpt?: string
}

export interface ParseKBUpdatesResult {
  proposals: KBUpdateProposal[]
  rejectedProposals: RejectedProposal[]
}

// --- Rejection reason constants ---

export const REJECTION_REASONS = {
  STRUCTURAL_REQUIRES_PATCH: 'Structural files require mode: patch.',
  STATUS_NO_PATCH: "Status files don't support mode: patch (no patch engine).",
  DELETE_NEEDS_CONFIRM: 'Delete requires confirmation.',
  invalidAction: (val: string) => `Invalid action: '${val}'.`,
  PATH_TRAVERSAL: 'File path rejected: path traversal.',
  MISSING_FIELDS: 'Missing required fields: action and/or reasoning.',
} as const

const VALID_ACTIONS = new Set(['create', 'update', 'delete'])
const VALID_MODES = new Set(['full', 'append', 'patch'])
const VALID_BASES = new Set(['primary', 'sibling', 'external', 'user'])

/** Strip control chars (except \t \n \r) */
function sanitizeExcerpt(raw: string): string {
  return raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').slice(0, 200)
}

function buildRejectedId(file: string, action: string, reason: string, tier?: string, mode?: string): string {
  return fnv1aHash(`${file}|${action}|${reason}|${tier ?? ''}|${mode ?? ''}`)
}

export function parseKBUpdates(text: string): ParseKBUpdatesResult {
  if (!text) return { proposals: [], rejectedProposals: [] }

  const proposals: KBUpdateProposal[] = []
  const rejectedProposals: RejectedProposal[] = []
  const blockRegex = /```kb-update\n([\s\S]*?)```/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(text)) !== null) {
    const blockContent = match[1]
    const separatorIndex = blockContent.indexOf('\n---\n')

    if (separatorIndex === -1) {
      // No separator — check if file: is present to decide ignore vs reject
      const fileMatch = blockContent.match(/^file:\s*(.+)$/m)
      if (!fileMatch) continue // ignore: not even a proposal attempt
      // Has file but no separator — reject
      const file = fileMatch[1].trim()
      const rawExcerpt = sanitizeExcerpt(blockContent)
      rejectedProposals.push({
        id: buildRejectedId(file, '', REJECTION_REASONS.MISSING_FIELDS),
        file,
        action: '',
        reasoning: '',
        rejectionReason: REJECTION_REASONS.MISSING_FIELDS,
        rawExcerpt,
      })
      continue
    }

    const header = blockContent.slice(0, separatorIndex)
    const content = blockContent.slice(separatorIndex + 5) // skip '\n---\n'
    const rawExcerpt = sanitizeExcerpt(blockContent)

    const fileMatch = header.match(/^file:\s*(.+)$/m)
    const actionMatch = header.match(/^action:\s*(.+)$/m)
    const reasoningMatch = header.match(/^reasoning:\s*(.+)$/m)

    if (!fileMatch) continue // ignore: no file field

    const file = fileMatch[1].trim()

    // Has file: but missing action: or reasoning: → reject
    if (!actionMatch || !reasoningMatch) {
      rejectedProposals.push({
        id: buildRejectedId(file, actionMatch?.[1]?.trim() ?? '', REJECTION_REASONS.MISSING_FIELDS),
        file,
        action: actionMatch?.[1]?.trim() ?? '',
        reasoning: reasoningMatch?.[1]?.trim() ?? '',
        rejectionReason: REJECTION_REASONS.MISSING_FIELDS,
        rawExcerpt,
      })
      continue
    }

    const action = actionMatch[1].trim()

    // Invalid action
    if (!VALID_ACTIONS.has(action)) {
      const reason = REJECTION_REASONS.invalidAction(action)
      rejectedProposals.push({
        id: buildRejectedId(file, action, reason),
        file,
        action,
        reasoning: reasoningMatch[1].trim(),
        rejectionReason: reason,
        rawExcerpt,
      })
      continue
    }

    // Reject path traversal, absolute paths, and null bytes
    const normalized = posix.normalize(file.replace(/\\/g, '/'))
    if (
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      normalized.startsWith('/') ||
      isAbsolute(file) ||
      win32.isAbsolute(file) ||
      file.includes('\0')
    ) {
      rejectedProposals.push({
        id: buildRejectedId(file, action, REJECTION_REASONS.PATH_TRAVERSAL),
        file,
        action,
        reasoning: reasoningMatch[1].trim(),
        rejectionReason: REJECTION_REASONS.PATH_TRAVERSAL,
        rawExcerpt,
      })
      continue
    }

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
    if (tier === 'structural' && mode !== 'patch') {
      rejectedProposals.push({
        id: buildRejectedId(file, action, REJECTION_REASONS.STRUCTURAL_REQUIRES_PATCH, tier, mode),
        file,
        action,
        reasoning: reasoningMatch[1].trim(),
        rejectionReason: REJECTION_REASONS.STRUCTURAL_REQUIRES_PATCH,
        suggestedFix: 'Change mode to patch.',
        tier,
        mode,
        rawExcerpt,
      })
      continue
    }
    if (tier === 'status' && mode === 'patch') {
      rejectedProposals.push({
        id: buildRejectedId(file, action, REJECTION_REASONS.STATUS_NO_PATCH, tier, mode),
        file,
        action,
        reasoning: reasoningMatch[1].trim(),
        rejectionReason: REJECTION_REASONS.STATUS_NO_PATCH,
        suggestedFix: 'Change mode to full or append with complete file content.',
        tier,
        mode,
        rawExcerpt,
      })
      continue
    }

    // Validate delete confirmation
    if (action === 'delete') {
      const confirmValue = confirmMatch ? confirmMatch[1].trim() : ''
      if (confirmValue !== `DELETE ${file}`) {
        rejectedProposals.push({
          id: buildRejectedId(file, action, REJECTION_REASONS.DELETE_NEEDS_CONFIRM),
          file,
          action,
          reasoning: reasoningMatch[1].trim(),
          rejectionReason: REJECTION_REASONS.DELETE_NEEDS_CONFIRM,
          suggestedFix: `Add: confirm: DELETE ${file}`,
          rawExcerpt,
        })
        continue
      }
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

  return { proposals, rejectedProposals }
}

/** Backward-compatible wrapper returning only valid proposals. */
export function parseKBUpdatesCompat(text: string): KBUpdateProposal[] {
  return parseKBUpdates(text).proposals
}
