/**
 * Session repository — manages chat session lifecycle.
 * Sessions track scope, model info, and timing for audit correlation.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateSessionInputSchema } from './schemas.js'
import type { Session, CreateSessionInput, SessionStatus } from './schemas.js'

interface SessionRow {
  id: string
  domain_id: string
  scope: string
  status: string
  model_provider: string
  model_name: string
  started_at: string
  ended_at: string | null
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    domainId: row.domain_id,
    scope: row.scope as Session['scope'],
    status: row.status as SessionStatus,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateSessionInput): Result<Session, DomainOSError> {
    const parsed = CreateSessionInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO sessions (id, domain_id, scope, status, model_provider, model_name, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, parsed.data.domainId, parsed.data.scope, 'active', parsed.data.modelProvider, parsed.data.modelName, now)

      return Ok({
        id,
        domainId: parsed.data.domainId,
        scope: parsed.data.scope,
        status: 'active',
        modelProvider: parsed.data.modelProvider,
        modelName: parsed.data.modelName,
        startedAt: now,
        endedAt: null,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getActive(domainId: string): Result<Session | null, DomainOSError> {
    try {
      const row = this.db
        .prepare("SELECT * FROM sessions WHERE domain_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
        .get(domainId) as SessionRow | undefined
      return Ok(row ? rowToSession(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  end(id: string): Result<Session, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    if (!row) return Err(DomainOSError.notFound('Session', id))

    const now = new Date().toISOString()

    try {
      this.db
        .prepare("UPDATE sessions SET status = 'wrapped_up', ended_at = ? WHERE id = ?")
        .run(now, id)
      return Ok(rowToSession({ ...row, status: 'wrapped_up', ended_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(domainId: string, limit = 50): Result<Session[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM sessions WHERE domain_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(domainId, limit) as SessionRow[]
      return Ok(rows.map(rowToSession))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
