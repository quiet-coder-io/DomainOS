/**
 * Brainstorm tool definitions and executors for LLM tool-use.
 *
 * 6 tools for deep brainstorming sessions:
 * - brainstorm_start_session: start or resume a brainstorm session
 * - brainstorm_get_techniques: browse/search technique library
 * - brainstorm_capture_ideas: save ideas with auto-round management
 * - brainstorm_session_status: get current session state
 * - brainstorm_synthesize: deterministic clustering → advisory payload
 * - brainstorm_session_control: pause/resume/close
 *
 * All sync executors (DB-only, no external API calls).
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ToolDefinition, BrainstormErrorCode } from '@domain-os/core'
import {
  BrainstormSessionRepository,
  getByCategory,
  getById as getTechniqueById,
  recommend,
  ALL_TECHNIQUES,
  TECHNIQUE_CATEGORIES,
  synthesize,
} from '@domain-os/core'
import type { TechniqueCategory } from '@domain-os/core'

// ── Tool Definitions ──

export const BRAINSTORM_TOOLS: ToolDefinition[] = [
  {
    name: 'brainstorm_start_session',
    description:
      'Start a new deep brainstorming session or return an existing active session. Returns technique recommendations based on topic. Use for extensive creative exploration with 10+ ideas.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The brainstorming topic (1-1000 chars).' },
        goals: { type: 'string', description: 'Optional goals to guide technique selection (max 2000 chars).' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'brainstorm_get_techniques',
    description:
      'Browse or search the brainstorming technique library. Returns technique names, categories, and descriptions. Use to discover fresh approaches mid-session.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: [...TECHNIQUE_CATEGORIES],
          description: 'Filter by technique category.',
        },
        topic: { type: 'string', description: 'Topic for heuristic recommendation (returns sorted by relevance).' },
        offset: { type: 'number', description: 'Pagination offset. Default 0.' },
        limit: { type: 'number', description: 'Results per page, 1-20. Default 10.' },
      },
      required: [],
    },
  },
  {
    name: 'brainstorm_capture_ideas',
    description:
      'Save 1-50 ideas to the active brainstorm session. Auto-creates rounds based on technique. Use frequently during facilitation — ideas not captured are lost.',
    inputSchema: {
      type: 'object',
      properties: {
        ideas: {
          type: 'array',
          items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          description: 'Array of idea objects with text field. 1-50 ideas per call.',
        },
        techniqueId: { type: 'string', description: 'Optional technique ID for this batch. Defaults to current technique.' },
      },
      required: ['ideas'],
    },
  },
  {
    name: 'brainstorm_session_status',
    description:
      'Get the current brainstorm session state including topic, step, idea count, rounds, and selected techniques.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'brainstorm_synthesize',
    description:
      'Run deterministic synthesis on all captured ideas. Groups by keyword overlap, ranks clusters, produces structured advisory payload. Stores preview for recovery. Set close=true (default) to auto-complete the session.',
    inputSchema: {
      type: 'object',
      properties: {
        close: { type: 'boolean', description: 'Whether to close the session after synthesis. Default true.' },
      },
      required: [],
    },
  },
  {
    name: 'brainstorm_session_control',
    description:
      'Pause, resume, or close the active brainstorm session. All operations are idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['pause', 'resume', 'close'],
          description: 'The control action to perform.',
        },
      },
      required: ['action'],
    },
  },
]

// ── Error response helper ──

function errorResponse(code: BrainstormErrorCode, message: string): string {
  return `BRAINSTORM_ERROR: ${code} — ${message}`
}

// ── Executor ──

export function executeBrainstormTool(
  db: Database.Database,
  toolName: string,
  input: Record<string, unknown>,
  domainId?: string,
): string {
  const repo = new BrainstormSessionRepository(db)

  try {
    switch (toolName) {
      case 'brainstorm_start_session':
        return execStartSession(repo, input, domainId)
      case 'brainstorm_get_techniques':
        return execGetTechniques(input)
      case 'brainstorm_capture_ideas':
        return execCaptureIdeas(repo, input, domainId)
      case 'brainstorm_session_status':
        return execSessionStatus(repo, domainId)
      case 'brainstorm_synthesize':
        return execSynthesize(repo, input, domainId)
      case 'brainstorm_session_control':
        return execSessionControl(repo, input, domainId)
      default:
        return `BRAINSTORM_ERROR: Unknown tool ${toolName}`
    }
  } catch (e) {
    return `BRAINSTORM_ERROR: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ── Individual Executors ──

function execStartSession(
  repo: BrainstormSessionRepository,
  input: Record<string, unknown>,
  domainId?: string,
): string {
  if (!domainId) return errorResponse('NO_SESSION', 'No domain context')

  const topic = typeof input.topic === 'string' ? input.topic : ''
  const goals = typeof input.goals === 'string' ? input.goals : ''

  if (!topic) return errorResponse('NO_SESSION', 'topic is required')

  // Check for existing active session
  const existing = repo.getActive(domainId)
  if (existing.ok && existing.value) {
    const session = existing.value
    const recommendations = recommend(session.topic, session.goals)

    const status = session.isPaused ? 'existing_paused' : 'existing_running'
    const hint = session.isPaused
      ? 'A paused session exists. Resume or close it.'
      : 'A session is already active. Continue or close it.'

    return JSON.stringify({
      status,
      hint,
      session: {
        id: session.id,
        topic: session.topic,
        step: session.step,
        phase: session.phase,
        isPaused: session.isPaused,
        ideaCount: session.ideaCount,
      },
      recommendations: {
        techniques: recommendations.techniques.slice(0, 10).map((t) => ({
          id: t.id, name: t.name, category: t.category, description: t.description,
        })),
        source: recommendations.source,
      },
    })
  }

  // Create new session
  const result = repo.create({ domainId, topic, goals })
  if (!result.ok) {
    if (result.error.message.includes('DB_CONSTRAINT')) {
      return errorResponse('DB_CONSTRAINT', 'An active session already exists')
    }
    return errorResponse('NO_SESSION', result.error.message)
  }

  // Set step to technique_selection
  repo.setStep(result.value.id, 'technique_selection')

  const recommendations = recommend(topic, goals)

  return JSON.stringify({
    status: 'created',
    session: {
      id: result.value.id,
      topic: result.value.topic,
      step: 'technique_selection',
      phase: 'divergent',
      isPaused: false,
      ideaCount: 0,
    },
    recommendations: {
      techniques: recommendations.techniques.slice(0, 10).map((t) => ({
        id: t.id, name: t.name, category: t.category, description: t.description,
      })),
      source: recommendations.source,
    },
  })
}

function execGetTechniques(input: Record<string, unknown>): string {
  const category = typeof input.category === 'string' ? input.category as TechniqueCategory : undefined
  const topic = typeof input.topic === 'string' ? input.topic : undefined
  const offset = typeof input.offset === 'number' ? Math.max(0, Math.floor(input.offset)) : 0
  const limit = typeof input.limit === 'number' ? Math.min(20, Math.max(1, Math.floor(input.limit))) : 10

  let techniques: Array<{ id: string; name: string; category: string; description: string }>

  if (topic) {
    const result = recommend(topic)
    techniques = result.techniques.map((t) => ({
      id: t.id, name: t.name, category: t.category, description: t.description,
    }))
  } else if (category && TECHNIQUE_CATEGORIES.includes(category)) {
    techniques = getByCategory(category).map((t) => ({
      id: t.id, name: t.name, category: t.category, description: t.description,
    }))
  } else {
    techniques = ALL_TECHNIQUES.map((t) => ({
      id: t.id, name: t.name, category: t.category, description: t.description,
    }))
  }

  const total = techniques.length
  const paginated = techniques.slice(offset, offset + limit)

  return JSON.stringify({
    techniques: paginated,
    total,
    source: topic ? 'heuristic' : 'library',
  })
}

function execCaptureIdeas(
  repo: BrainstormSessionRepository,
  input: Record<string, unknown>,
  domainId?: string,
): string {
  if (!domainId) return errorResponse('NO_SESSION', 'No domain context')

  const active = repo.getActive(domainId)
  if (!active.ok || !active.value) {
    return JSON.stringify({ status: 'no_session', error: { code: 'NO_SESSION', message: 'No active brainstorm session' } })
  }

  const session = active.value
  const ideas = Array.isArray(input.ideas) ? input.ideas as Array<{ text: string }> : []
  const techniqueId = typeof input.techniqueId === 'string' ? input.techniqueId : undefined

  if (ideas.length === 0 || ideas.length > 50) {
    return errorResponse('NO_SESSION', 'ideas must contain 1-50 items')
  }

  // Validate each idea has text
  const validIdeas = ideas.filter((i) => typeof i.text === 'string' && i.text.trim().length > 0)
  if (validIdeas.length === 0) {
    return errorResponse('NO_SESSION', 'No valid ideas provided')
  }

  // Ensure we're in a step that allows idea capture
  if (session.step === 'setup') {
    // Auto-advance to technique_selection then execution
    repo.setStep(session.id, 'technique_selection')
    if (session.selectedTechniques.length > 0 || techniqueId) {
      repo.setStep(session.id, 'execution')
    }
  }
  if (session.step === 'technique_selection') {
    // Need to select techniques before capturing
    if (techniqueId) {
      repo.updateSelectedTechniques(session.id, [techniqueId])
      repo.setStep(session.id, 'execution')
    }
  }

  const result = repo.addIdeas(session.id, validIdeas, techniqueId)
  if (!result.ok) {
    const msg = result.error.message
    if (msg.includes('CAP_REACHED')) {
      return JSON.stringify({
        status: 'capped',
        ideaCount: session.ideaCount,
        roundNumber: session.rounds.length,
        message: 'Idea cap reached. Use brainstorm_synthesize to organize ideas.',
      })
    }
    return errorResponse('NO_SESSION', msg)
  }

  return JSON.stringify({
    status: result.value.capped ? 'capped' : 'ok',
    ideaCount: result.value.session.ideaCount,
    roundNumber: result.value.roundNumber,
    message: result.value.capped ? 'Idea cap reached. Consider synthesizing.' : undefined,
  })
}

function execSessionStatus(
  repo: BrainstormSessionRepository,
  domainId?: string,
): string {
  if (!domainId) return JSON.stringify({ status: 'no_session' })

  const active = repo.getActive(domainId)
  if (!active.ok || !active.value) {
    return JSON.stringify({ status: 'no_session' })
  }

  const session = active.value

  return JSON.stringify({
    status: 'active',
    session: {
      id: session.id,
      topic: session.topic,
      goals: session.goals,
      step: session.step,
      phase: session.phase,
      isPaused: session.isPaused,
      ideaCount: session.ideaCount,
      rounds: session.rounds.map((r) => ({
        techniqueId: r.techniqueId,
        name: r.techniqueNameSnapshot,
        ideaCount: r.ideaCount,
      })),
      selectedTechniques: session.selectedTechniques,
    },
  })
}

function execSynthesize(
  repo: BrainstormSessionRepository,
  input: Record<string, unknown>,
  domainId?: string,
): string {
  if (!domainId) return JSON.stringify({ status: 'no_session' })

  const active = repo.getActive(domainId)
  if (!active.ok || !active.value) {
    return JSON.stringify({ status: 'no_session', error: { code: 'NO_SESSION', message: 'No active brainstorm session' } })
  }

  const session = active.value
  const shouldClose = typeof input.close === 'boolean' ? input.close : true

  if (session.ideaCount < 3) {
    return JSON.stringify({
      status: 'insufficient_ideas',
      message: `Need at least 3 ideas to synthesize (have ${session.ideaCount}).`,
      error: { code: 'INSUFFICIENT_IDEAS', message: `Have ${session.ideaCount} ideas, need at least 3` },
    })
  }

  // Advance to synthesis step if not there
  if (session.step !== 'synthesis' && session.step !== 'completed') {
    const stepResult = repo.setStep(session.id, 'synthesis')
    if (!stepResult.ok) {
      // Try direct: might be in execution which can go to synthesis
      // If we can't transition, still synthesize (the payload is the important part)
    }
  }

  // Run deterministic synthesizer
  const payload = synthesize(session.rawIdeas, {
    topic: session.topic,
    techniquesUsed: session.selectedTechniques,
    roundCount: session.rounds.length,
  })

  // Store preview with hash for recovery
  const payloadStr = JSON.stringify(payload)
  const hash = createHash('sha256').update(payloadStr).digest('hex')
  const preview = JSON.stringify({ schemaVersion: 1, payload, hash })
  repo.setSynthesisPreview(session.id, preview)

  // Close session if requested
  let closedSessionId: string | undefined
  if (shouldClose) {
    const closeResult = repo.close(session.id)
    if (closeResult.ok) {
      closedSessionId = closeResult.value.closedSessionId
    }
  }

  return JSON.stringify({
    status: 'ok',
    preview: payload,
    closedSessionId,
  })
}

function execSessionControl(
  repo: BrainstormSessionRepository,
  input: Record<string, unknown>,
  domainId?: string,
): string {
  if (!domainId) return JSON.stringify({ status: 'no_session' })

  const action = typeof input.action === 'string' ? input.action : ''

  const active = repo.getActive(domainId)
  if (!active.ok || !active.value) {
    return JSON.stringify({ status: 'no_session' })
  }

  const session = active.value

  switch (action) {
    case 'pause': {
      if (session.isPaused) return JSON.stringify({ status: 'already_paused' })
      const result = repo.pause(session.id)
      if (!result.ok) return errorResponse('ILLEGAL_TRANSITION', result.error.message)
      return JSON.stringify({ status: 'ok' })
    }
    case 'resume': {
      if (!session.isPaused) return JSON.stringify({ status: 'already_running' })
      const result = repo.resume(session.id)
      if (!result.ok) return errorResponse('ILLEGAL_TRANSITION', result.error.message)
      return JSON.stringify({ status: 'ok' })
    }
    case 'close': {
      if (session.step === 'completed') return JSON.stringify({ status: 'already_completed', closedSessionId: session.id })
      const result = repo.close(session.id)
      if (!result.ok) return errorResponse('ILLEGAL_TRANSITION', result.error.message)
      return JSON.stringify({ status: 'ok', closedSessionId: result.value.closedSessionId })
    }
    default:
      return errorResponse('ILLEGAL_TRANSITION', `Unknown action: ${action}`)
  }
}
