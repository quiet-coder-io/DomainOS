/**
 * Deterministic task extraction from advisory artifacts.
 * No LLM call — type-specific field extraction with validation.
 */

import type { AdvisoryArtifact, ExtractedTask, NeedsEditingTask, TurnIntoTasksOutput } from './schemas.js'

// ── Action verb lists ──

const ACTION_VERBS = new Set([
  'contact', 'call', 'email', 'schedule', 'review', 'audit', 'check',
  'update', 'create', 'draft', 'prepare', 'send', 'follow', 'confirm',
  'negotiate', 'research', 'analyze', 'evaluate', 'assess', 'verify',
  'monitor', 'track', 'investigate', 'resolve', 'implement', 'complete',
  'submit', 'request', 'coordinate', 'establish', 'document', 'obtain',
  'secure', 'compare', 'finalize', 'approve', 'reject', 'escalate',
  'meet', 'discuss', 'plan', 'set', 'define', 'configure', 'test',
  'deploy', 'migrate', 'refactor', 'fix', 'address', 'identify',
])

const NOUN_ACTION_VERBS = new Set([
  'review', 'audit', 'call', 'email', 'schedule', 'check', 'update',
])

function hasActionIndicator(title: string): boolean {
  const words = title.toLowerCase().split(/\s+/)
  // (a) starts with a verb from common action verb list
  if (words.length > 0 && ACTION_VERBS.has(words[0])) return true

  // (b) matches [Noun] + action verb pattern
  if (words.length >= 2 && NOUN_ACTION_VERBS.has(words[1])) return true

  // (c) contains an action verb anywhere in the first 4 words
  const firstFour = words.slice(0, 4)
  for (const word of firstFour) {
    if (ACTION_VERBS.has(word)) return true
  }

  return false
}

function validateTask(
  title: string,
  sourceField: string,
): { valid: ExtractedTask | null; needsEditing: NeedsEditingTask | null } {
  const trimmed = title.trim()

  if (trimmed.length < 6) {
    return {
      valid: null,
      needsEditing: {
        title: trimmed,
        reason: 'too_short',
        sourceField,
      },
    }
  }

  if (trimmed.length > 120) {
    return {
      valid: null,
      needsEditing: {
        title: trimmed,
        reason: 'too_long',
        suggestion: trimmed.slice(0, 120),
        sourceField,
      },
    }
  }

  if (!hasActionIndicator(trimmed)) {
    return {
      valid: null,
      needsEditing: {
        title: trimmed,
        reason: 'no_action_indicator',
        suggestion: `Review: ${trimmed}`,
        sourceField,
      },
    }
  }

  return {
    valid: {
      title: trimmed,
      priority: 'medium',
      sourceField,
    },
    needsEditing: null,
  }
}

function dedup(tasks: ExtractedTask[]): ExtractedTask[] {
  const seen = new Set<string>()
  return tasks.filter((t) => {
    const key = t.title.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Type-specific extractors ──

function extractFromBrainstorm(content: Record<string, unknown>): { tasks: ExtractedTask[]; needs: NeedsEditingTask[] } {
  const tasks: ExtractedTask[] = []
  const needs: NeedsEditingTask[] = []

  const options = content.options as Array<Record<string, unknown>> | undefined

  if (options && options.length > 0) {
    // Preferred: options[].action
    const hasActions = options.some((o) => typeof o.action === 'string' && o.action.trim())
    if (hasActions) {
      for (let i = 0; i < options.length; i++) {
        const action = options[i].action
        if (typeof action === 'string' && action.trim()) {
          const result = validateTask(action.trim(), `options[${i}].action`)
          if (result.valid) tasks.push(result.valid)
          if (result.needsEditing) needs.push(result.needsEditing)
        }
      }
    } else {
      // Fallback: recommendation as single task
      const recommendation = content.recommendation
      if (typeof recommendation === 'string' && recommendation.trim()) {
        const recTitle = recommendation.trim().length > 120
          ? recommendation.trim().slice(0, 117) + '...'
          : recommendation.trim()
        const result = validateTask(recTitle, 'recommendation')
        if (result.valid) tasks.push(result.valid)
        if (result.needsEditing) needs.push(result.needsEditing)
      } else {
        // Last fallback: option titles with "Evaluate: "
        for (let i = 0; i < options.length; i++) {
          const optTitle = options[i].title
          if (typeof optTitle === 'string' && optTitle.trim()) {
            const prefixed = `Evaluate: ${optTitle.trim()}`
            const result = validateTask(prefixed, `options[${i}].title`)
            if (result.valid) tasks.push(result.valid)
            if (result.needsEditing) needs.push(result.needsEditing)
          }
        }
      }
    }
  }

  return { tasks, needs }
}

function extractFromRiskAssessment(content: Record<string, unknown>): { tasks: ExtractedTask[]; needs: NeedsEditingTask[] } {
  const tasks: ExtractedTask[] = []
  const needs: NeedsEditingTask[] = []

  const risks = content.risks as Array<Record<string, unknown>> | undefined
  if (risks) {
    for (let i = 0; i < risks.length; i++) {
      const mitigation = risks[i].mitigation
      if (typeof mitigation === 'string' && mitigation.trim()) {
        const mitTitle = mitigation.trim().length > 120
          ? mitigation.trim().slice(0, 117) + '...'
          : mitigation.trim()
        const result = validateTask(mitTitle, `risks[${i}].mitigation`)
        if (result.valid) {
          result.valid.priority = 'high'
          tasks.push(result.valid)
        }
        if (result.needsEditing) needs.push(result.needsEditing)
      }
    }
  }

  return { tasks, needs }
}

function extractFromScenario(content: Record<string, unknown>): { tasks: ExtractedTask[]; needs: NeedsEditingTask[] } {
  const tasks: ExtractedTask[] = []
  const needs: NeedsEditingTask[] = []

  const triggers = content.triggers as string[] | undefined
  if (triggers) {
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].trim()) {
        const prefixed = `Monitor: ${triggers[i].trim()}`
        const result = validateTask(prefixed, `triggers[${i}]`)
        if (result.valid) {
          result.valid.priority = 'low'
          tasks.push(result.valid)
        }
        if (result.needsEditing) needs.push(result.needsEditing)
      }
    }
  }

  return { tasks, needs }
}

function extractFromStrategicReview(content: Record<string, unknown>): { tasks: ExtractedTask[]; needs: NeedsEditingTask[] } {
  const tasks: ExtractedTask[] = []
  const needs: NeedsEditingTask[] = []

  // Primary: highest_leverage_action
  const hla = content.highest_leverage_action
  if (typeof hla === 'string' && hla.trim()) {
    const hlaTitle = hla.trim().length > 120 ? hla.trim().slice(0, 117) + '...' : hla.trim()
    const result = validateTask(hlaTitle, 'highest_leverage_action')
    if (result.valid) {
      result.valid.priority = 'high'
      tasks.push(result.valid)
    }
    if (result.needsEditing) needs.push(result.needsEditing)
  }

  // Secondary: assumptions_to_check
  const assumptions = content.assumptions_to_check as string[] | undefined
  if (assumptions) {
    for (let i = 0; i < assumptions.length; i++) {
      if (assumptions[i].trim()) {
        const prefixed = `Verify: ${assumptions[i].trim()}`
        const result = validateTask(prefixed, `assumptions_to_check[${i}]`)
        if (result.valid) {
          result.valid.priority = 'medium'
          tasks.push(result.valid)
        }
        if (result.needsEditing) needs.push(result.needsEditing)
      }
    }
  }

  return { tasks, needs }
}

// ── Main extraction function ──

export function extractTasksFromArtifact(artifact: AdvisoryArtifact): TurnIntoTasksOutput {
  let content: Record<string, unknown>
  try {
    content = JSON.parse(artifact.content) as Record<string, unknown>
  } catch {
    return {
      tasks: [],
      needsEditing: [],
      artifactId: artifact.id,
      artifactTitle: artifact.title,
    }
  }

  let extracted: { tasks: ExtractedTask[]; needs: NeedsEditingTask[] }

  switch (artifact.type) {
    case 'brainstorm':
      extracted = extractFromBrainstorm(content)
      break
    case 'risk_assessment':
      extracted = extractFromRiskAssessment(content)
      break
    case 'scenario':
      extracted = extractFromScenario(content)
      break
    case 'strategic_review':
      extracted = extractFromStrategicReview(content)
      break
    default:
      extracted = { tasks: [], needs: [] }
  }

  return {
    tasks: dedup(extracted.tasks),
    needsEditing: extracted.needs,
    artifactId: artifact.id,
    artifactTitle: artifact.title,
  }
}
