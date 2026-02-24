/**
 * Brainstorm session repository — CRUD with step transition graph,
 * idempotent pause/resume, auto-round creation, and 500-idea soft cap.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import {
  STEP_TRANSITIONS,
  PAUSABLE_STEPS,
  BRAINSTORM_IDEA_SOFT_CAP,
  BRAINSTORM_SCHEMA_VERSION,
} from './schemas.js'
import type {
  BrainstormSession,
  BrainstormStep,
  BrainstormRound,
  RawIdea,
  BrainstormErrorCode,
  CreateBrainstormSessionInput,
} from './schemas.js'
import { CreateBrainstormSessionInputSchema } from './schemas.js'
import { getById as getTechniqueById } from './technique-library.js'

// ── DB Row type ──

interface BrainstormSessionRow {
  id: string
  session_id: string | null
  domain_id: string
  schema_version: number
  step: string
  phase: string
  is_paused: number
  topic: string
  goals: string
  selected_techniques: string
  rounds: string
  raw_ideas: string
  idea_count: number
  synthesis_preview: string
  created_at: string
  updated_at: string
}

function rowToSession(row: BrainstormSessionRow): BrainstormSession {
  return {
    id: row.id,
    domainId: row.domain_id,
    sessionId: row.session_id,
    schemaVersion: row.schema_version,
    step: row.step as BrainstormStep,
    phase: row.phase as 'divergent' | 'convergent',
    isPaused: row.is_paused === 1,
    topic: row.topic,
    goals: row.goals,
    selectedTechniques: JSON.parse(row.selected_techniques) as string[],
    rounds: JSON.parse(row.rounds) as BrainstormRound[],
    rawIdeas: JSON.parse(row.raw_ideas) as RawIdea[],
    ideaCount: row.idea_count,
    synthesisPreview: row.synthesis_preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function brainstormError(code: BrainstormErrorCode, message: string): DomainOSError {
  return DomainOSError.validation(`[BRAINSTORM:${code}] ${message}`)
}

export class BrainstormSessionRepository {
  constructor(private db: Database.Database) {}

  /**
   * Create a new brainstorm session.
   * Active uniqueness enforced at DB level (one non-completed per domain).
   */
  create(input: CreateBrainstormSessionInput): Result<BrainstormSession, DomainOSError> {
    const parsed = CreateBrainstormSessionInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const data = parsed.data
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO brainstorm_sessions (
            id, session_id, domain_id, schema_version, step, phase, is_paused,
            topic, goals, selected_techniques, rounds, raw_ideas, idea_count,
            synthesis_preview, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'setup', 'divergent', 0, ?, ?, '[]', '[]', '[]', 0, '', ?, ?)`,
        )
        .run(
          id,
          data.sessionId ?? null,
          data.domainId,
          BRAINSTORM_SCHEMA_VERSION,
          data.topic,
          data.goals,
          now,
          now,
        )

      return Ok({
        id,
        domainId: data.domainId,
        sessionId: data.sessionId ?? null,
        schemaVersion: BRAINSTORM_SCHEMA_VERSION,
        step: 'setup',
        phase: 'divergent',
        isPaused: false,
        topic: data.topic,
        goals: data.goals,
        selectedTechniques: [],
        rounds: [],
        rawIdeas: [],
        ideaCount: 0,
        synthesisPreview: '',
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('UNIQUE constraint failed')) {
        return Err(brainstormError('DB_CONSTRAINT', 'An active brainstorm session already exists for this domain'))
      }
      return Err(DomainOSError.db(msg))
    }
  }

  /**
   * Get the active (non-completed) session for a domain.
   * Returns paused sessions too — protocol guides "resume or close?" when isPaused.
   */
  getActive(domainId: string): Result<BrainstormSession | null, DomainOSError> {
    try {
      const row = this.db
        .prepare("SELECT * FROM brainstorm_sessions WHERE domain_id = ? AND step != 'completed' LIMIT 1")
        .get(domainId) as BrainstormSessionRow | undefined
      return Ok(row ? rowToSession(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /** Get a session by ID. */
  getById(id: string): Result<BrainstormSession, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM brainstorm_sessions WHERE id = ?')
        .get(id) as BrainstormSessionRow | undefined
      if (!row) return Err(DomainOSError.notFound('BrainstormSession', id))
      return Ok(rowToSession(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Set session step — validates against transition graph.
   * Rejects illegal transitions with clear error.
   */
  setStep(id: string, step: BrainstormStep): Result<BrainstormSession, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    const session = current.value
    const allowed = STEP_TRANSITIONS[session.step]

    if (!allowed.includes(step)) {
      return Err(brainstormError('ILLEGAL_TRANSITION', `Cannot transition from '${session.step}' to '${step}'`))
    }

    // technique_selection → setup only if ideaCount === 0
    if (session.step === 'technique_selection' && step === 'setup' && session.ideaCount > 0) {
      return Err(brainstormError('ILLEGAL_TRANSITION', 'Cannot restart: ideas already captured'))
    }

    // synthesis requires ideaCount >= 3
    if (step === 'synthesis' && session.ideaCount < 3) {
      return Err(brainstormError('INSUFFICIENT_IDEAS', 'Synthesis requires at least 3 ideas'))
    }

    // Update phase based on step
    const phase = step === 'synthesis' || step === 'completed' ? 'convergent' : 'divergent'

    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET step = ?, phase = ?, updated_at = datetime('now') WHERE id = ?")
        .run(step, phase, id)
      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Update selected techniques for the session.
   */
  updateSelectedTechniques(id: string, techniques: string[]): Result<BrainstormSession, DomainOSError> {
    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET selected_techniques = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(techniques), id)
      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Add ideas to the session. Uses getOrCreateOpenRound() to auto-manage rounds.
   * Soft cap: 500 ideas.
   */
  addIdeas(
    id: string,
    ideas: Array<{ text: string }>,
    techniqueId?: string,
  ): Result<{ session: BrainstormSession; roundNumber: number; capped: boolean }, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    const session = current.value

    if (session.step === 'completed') {
      return Err(brainstormError('ILLEGAL_TRANSITION', 'Cannot add ideas to a completed session'))
    }

    const capped = session.ideaCount >= BRAINSTORM_IDEA_SOFT_CAP

    if (capped) {
      return Err(brainstormError('CAP_REACHED', `Idea soft cap reached (${BRAINSTORM_IDEA_SOFT_CAP}). Synthesize to proceed.`))
    }

    // Get or create open round (may write rounds to DB)
    const roundResult = this.getOrCreateOpenRound(id, session, techniqueId)
    if (!roundResult.ok) return roundResult

    const { roundNumber, techniqueId: resolvedTechniqueId, techniqueNameSnapshot, techniqueCategory } = roundResult.value

    // Re-fetch session after getOrCreateOpenRound — it may have written new rounds to DB
    const refreshed = this.getById(id)
    if (!refreshed.ok) return refreshed
    const freshSession = refreshed.value

    // Build new ideas
    const now = new Date().toISOString()
    const newIdeas: RawIdea[] = ideas.map((idea) => ({
      id: uuidv4(),
      text: idea.text,
      techniqueId: resolvedTechniqueId,
      techniqueNameSnapshot,
      category: techniqueCategory,
      round: roundNumber,
      timestamp: now,
    }))

    // Append to raw_ideas JSON, increment idea_count, update round ideaCount
    const updatedIdeas = [...freshSession.rawIdeas, ...newIdeas]
    const updatedRounds = [...freshSession.rounds]
    const roundIdx = updatedRounds.findIndex((r) => r.roundNumber === roundNumber)
    if (roundIdx >= 0) {
      updatedRounds[roundIdx] = {
        ...updatedRounds[roundIdx],
        ideaCount: updatedRounds[roundIdx].ideaCount + newIdeas.length,
      }
    }

    const newIdeaCount = freshSession.ideaCount + newIdeas.length
    const isNowCapped = newIdeaCount >= BRAINSTORM_IDEA_SOFT_CAP

    try {
      this.db
        .prepare(
          "UPDATE brainstorm_sessions SET raw_ideas = ?, rounds = ?, idea_count = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(JSON.stringify(updatedIdeas), JSON.stringify(updatedRounds), newIdeaCount, id)

      const updated = this.getById(id)
      if (!updated.ok) return updated
      return Ok({ session: updated.value, roundNumber, capped: isNowCapped })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Private helper: find open round (last with completedAt=null).
   * If none, create one using techniqueId ?? last selected technique ?? first selected technique.
   * Centralizes round creation logic for addIdeas.
   */
  private getOrCreateOpenRound(
    id: string,
    session: BrainstormSession,
    techniqueId?: string,
  ): Result<{ roundNumber: number; techniqueId: string; techniqueNameSnapshot: string; techniqueCategory: string }, DomainOSError> {
    const rounds = session.rounds

    // Find open round (last with completedAt=null)
    let openRound: BrainstormRound | undefined
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].completedAt === null) { openRound = rounds[i]; break }
    }

    if (openRound) {
      // If a specific technique was requested and differs from open round, close current and open new
      if (techniqueId && techniqueId !== openRound.techniqueId) {
        return this.createNewRound(id, session, techniqueId)
      }
      return Ok({
        roundNumber: openRound.roundNumber,
        techniqueId: openRound.techniqueId,
        techniqueNameSnapshot: openRound.techniqueNameSnapshot,
        techniqueCategory: openRound.techniqueCategory,
      })
    }

    // No open round — create one
    const resolvedTechniqueId =
      techniqueId ??
      (rounds.length > 0 ? rounds[rounds.length - 1].techniqueId : null) ??
      (session.selectedTechniques.length > 0 ? session.selectedTechniques[0] : null)

    if (!resolvedTechniqueId) {
      return Err(brainstormError('UNKNOWN_TECHNIQUE_ID', 'No technique available. Select techniques first.'))
    }

    return this.createNewRound(id, session, resolvedTechniqueId)
  }

  private createNewRound(
    id: string,
    session: BrainstormSession,
    techniqueId: string,
  ): Result<{ roundNumber: number; techniqueId: string; techniqueNameSnapshot: string; techniqueCategory: string }, DomainOSError> {
    const technique = getTechniqueById(techniqueId)
    const techniqueNameSnapshot = technique?.name ?? techniqueId
    const techniqueCategory = technique?.category ?? 'creative'

    const now = new Date().toISOString()
    const rounds = [...session.rounds]

    // Close prior open round if any
    let openIdx = -1
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].completedAt === null) { openIdx = i; break }
    }
    if (openIdx >= 0) {
      rounds[openIdx] = { ...rounds[openIdx], completedAt: now }
    }

    const newRoundNumber = rounds.length > 0 ? Math.max(...rounds.map((r) => r.roundNumber)) + 1 : 1

    const newRound: BrainstormRound = {
      roundNumber: newRoundNumber,
      techniqueId,
      techniqueNameSnapshot,
      techniqueCategory,
      ideaCount: 0,
      startedAt: now,
      completedAt: null,
    }

    rounds.push(newRound)

    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET rounds = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(rounds), id)

      return Ok({
        roundNumber: newRoundNumber,
        techniqueId,
        techniqueNameSnapshot,
        techniqueCategory,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Explicitly add/start a new round, closing any prior open round.
   */
  addRound(id: string, techniqueId: string): Result<BrainstormSession, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    const result = this.createNewRound(id, current.value, techniqueId)
    if (!result.ok) return result

    return this.getById(id)
  }

  /**
   * Pause the session. Idempotent (pause when already paused = success).
   * Closes any open round (completedAt = now).
   */
  pause(id: string): Result<BrainstormSession, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    const session = current.value

    // Idempotent: already paused = success
    if (session.isPaused) return Ok(session)

    if (!PAUSABLE_STEPS.includes(session.step)) {
      return Err(brainstormError('ILLEGAL_TRANSITION', `Cannot pause in step '${session.step}'`))
    }

    // Close any open round
    const now = new Date().toISOString()
    const rounds = [...session.rounds]
    let openIdx = -1
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].completedAt === null) { openIdx = i; break }
    }
    if (openIdx >= 0) {
      rounds[openIdx] = { ...rounds[openIdx], completedAt: now }
    }

    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET is_paused = 1, rounds = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(rounds), id)
      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Resume a paused session. Idempotent (resume when not paused = success).
   * Does NOT reopen a round — next capture_ideas via getOrCreateOpenRound() opens a new round.
   */
  resume(id: string): Result<BrainstormSession, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    const session = current.value

    // Idempotent: already running = success
    if (!session.isPaused) return Ok(session)

    if (!PAUSABLE_STEPS.includes(session.step)) {
      return Err(brainstormError('ILLEGAL_TRANSITION', `Cannot resume in step '${session.step}'`))
    }

    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET is_paused = 0, updated_at = datetime('now') WHERE id = ?")
        .run(id)
      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Close (complete) a session from any non-completed state.
   */
  close(id: string): Result<{ closedSessionId: string }, DomainOSError> {
    const current = this.getById(id)
    if (!current.ok) return current

    if (current.value.step === 'completed') {
      return Ok({ closedSessionId: id })
    }

    // Close any open round
    const now = new Date().toISOString()
    const rounds = [...current.value.rounds]
    let openIdx = -1
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].completedAt === null) { openIdx = i; break }
    }
    if (openIdx >= 0) {
      rounds[openIdx] = { ...rounds[openIdx], completedAt: now }
    }

    try {
      this.db
        .prepare(
          "UPDATE brainstorm_sessions SET step = 'completed', phase = 'convergent', is_paused = 0, rounds = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(JSON.stringify(rounds), id)
      return Ok({ closedSessionId: id })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Store synthesis preview for recovery if LLM fence block fails.
   * Stores {schemaVersion, payload, hash} JSON.
   */
  setSynthesisPreview(id: string, preview: string): Result<BrainstormSession, DomainOSError> {
    try {
      this.db
        .prepare("UPDATE brainstorm_sessions SET synthesis_preview = ?, updated_at = datetime('now') WHERE id = ?")
        .run(preview, id)
      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
