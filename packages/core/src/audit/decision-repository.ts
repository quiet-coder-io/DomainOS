/**
 * Decision repository — tracks significant decisions made during domain sessions.
 * Supports status lifecycle: active → superseded | rejected.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateDecisionInputSchema } from './schemas.js'
import type { Decision, CreateDecisionInput, DecisionStatus } from './schemas.js'

interface DecisionRow {
  id: string
  domain_id: string
  session_id: string | null
  decision_id: string
  decision: string
  rationale: string
  downside: string
  revisit_trigger: string
  status: string
  supersedes_decision_id: string | null
  linked_files: string
  created_at: string
  updated_at: string
}

function rowToDecision(row: DecisionRow): Decision {
  let linkedFiles: string[] = []
  try {
    linkedFiles = JSON.parse(row.linked_files)
  } catch {
    linkedFiles = []
  }

  return {
    id: row.id,
    domainId: row.domain_id,
    sessionId: row.session_id,
    decisionId: row.decision_id,
    decision: row.decision,
    rationale: row.rationale,
    downside: row.downside,
    revisitTrigger: row.revisit_trigger,
    status: row.status as DecisionStatus,
    supersedesDecisionId: row.supersedes_decision_id,
    linkedFiles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class DecisionRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateDecisionInput): Result<Decision, DomainOSError> {
    const parsed = CreateDecisionInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()
    const linkedFilesJson = JSON.stringify(parsed.data.linkedFiles)

    try {
      this.db
        .prepare(
          'INSERT INTO decisions (id, domain_id, session_id, decision_id, decision, rationale, downside, revisit_trigger, status, linked_files, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          parsed.data.domainId,
          parsed.data.sessionId ?? null,
          parsed.data.decisionId,
          parsed.data.decision,
          parsed.data.rationale,
          parsed.data.downside,
          parsed.data.revisitTrigger,
          'active',
          linkedFilesJson,
          now,
          now,
        )

      return Ok({
        id,
        domainId: parsed.data.domainId,
        sessionId: parsed.data.sessionId ?? null,
        decisionId: parsed.data.decisionId,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        downside: parsed.data.downside,
        revisitTrigger: parsed.data.revisitTrigger,
        status: 'active',
        supersedesDecisionId: null,
        linkedFiles: parsed.data.linkedFiles,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(domainId: string, limit = 100): Result<Decision[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM decisions WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, limit) as DecisionRow[]
      return Ok(rows.map(rowToDecision))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getActive(domainId: string): Result<Decision[], DomainOSError> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM decisions WHERE domain_id = ? AND status = 'active' ORDER BY created_at DESC")
        .all(domainId) as DecisionRow[]
      return Ok(rows.map(rowToDecision))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Supersede a decision: marks old as 'superseded', creates new with chain link.
   */
  supersede(
    oldDecisionId: string,
    newInput: CreateDecisionInput,
  ): Result<Decision, DomainOSError> {
    const oldRow = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(oldDecisionId) as
      | DecisionRow
      | undefined
    if (!oldRow) return Err(DomainOSError.notFound('Decision', oldDecisionId))

    const parsed = CreateDecisionInputSchema.safeParse(newInput)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const newId = uuidv4()
    const linkedFilesJson = JSON.stringify(parsed.data.linkedFiles)

    try {
      this.db.transaction(() => {
        // Mark old as superseded
        this.db
          .prepare("UPDATE decisions SET status = 'superseded', updated_at = ? WHERE id = ?")
          .run(now, oldDecisionId)

        // Create new with chain
        this.db
          .prepare(
            'INSERT INTO decisions (id, domain_id, session_id, decision_id, decision, rationale, downside, revisit_trigger, status, supersedes_decision_id, linked_files, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            newId,
            parsed.data.domainId,
            parsed.data.sessionId ?? null,
            parsed.data.decisionId,
            parsed.data.decision,
            parsed.data.rationale,
            parsed.data.downside,
            parsed.data.revisitTrigger,
            'active',
            oldDecisionId,
            linkedFilesJson,
            now,
            now,
          )
      })()

      return Ok({
        id: newId,
        domainId: parsed.data.domainId,
        sessionId: parsed.data.sessionId ?? null,
        decisionId: parsed.data.decisionId,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        downside: parsed.data.downside,
        revisitTrigger: parsed.data.revisitTrigger,
        status: 'active',
        supersedesDecisionId: oldDecisionId,
        linkedFiles: parsed.data.linkedFiles,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  reject(id: string): Result<Decision, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      | DecisionRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Decision', id))

    const now = new Date().toISOString()

    try {
      this.db
        .prepare("UPDATE decisions SET status = 'rejected', updated_at = ? WHERE id = ?")
        .run(now, id)

      return Ok(rowToDecision({ ...row, status: 'rejected', updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
