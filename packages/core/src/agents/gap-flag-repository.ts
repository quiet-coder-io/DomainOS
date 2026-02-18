/**
 * Gap flag repository — persistent storage for detected knowledge gaps.
 * Status lifecycle: open → acknowledged → resolved.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'

export interface GapFlag {
  id: string
  domainId: string
  sessionId: string | null
  category: string
  description: string
  sourceMessage: string
  status: 'open' | 'acknowledged' | 'resolved'
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateGapFlagInput {
  domainId: string
  sessionId?: string
  category: string
  description: string
  sourceMessage?: string
}

interface GapFlagRow {
  id: string
  domain_id: string
  session_id: string | null
  category: string
  description: string
  source_message: string
  status: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

function rowToGapFlag(row: GapFlagRow): GapFlag {
  return {
    id: row.id,
    domainId: row.domain_id,
    sessionId: row.session_id,
    category: row.category,
    description: row.description,
    sourceMessage: row.source_message,
    status: row.status as GapFlag['status'],
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class GapFlagRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateGapFlagInput): Result<GapFlag, DomainOSError> {
    if (!input.category || !input.description) {
      return Err(DomainOSError.validation('Category and description are required'))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO gap_flags (id, domain_id, session_id, category, description, source_message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, input.domainId, input.sessionId ?? null, input.category, input.description, input.sourceMessage ?? '', 'open', now, now)

      return Ok({
        id,
        domainId: input.domainId,
        sessionId: input.sessionId ?? null,
        category: input.category,
        description: input.description,
        sourceMessage: input.sourceMessage ?? '',
        status: 'open',
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(domainId: string, limit = 100): Result<GapFlag[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM gap_flags WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, limit) as GapFlagRow[]
      return Ok(rows.map(rowToGapFlag))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getOpen(domainId: string): Result<GapFlag[], DomainOSError> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM gap_flags WHERE domain_id = ? AND status = 'open' ORDER BY created_at DESC")
        .all(domainId) as GapFlagRow[]
      return Ok(rows.map(rowToGapFlag))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  acknowledge(id: string): Result<GapFlag, DomainOSError> {
    return this.updateStatus(id, 'acknowledged')
  }

  resolve(id: string): Result<GapFlag, DomainOSError> {
    return this.updateStatus(id, 'resolved')
  }

  private updateStatus(id: string, status: GapFlag['status']): Result<GapFlag, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM gap_flags WHERE id = ?').get(id) as GapFlagRow | undefined
    if (!row) return Err(DomainOSError.notFound('GapFlag', id))

    const now = new Date().toISOString()
    const resolvedAt = status === 'resolved' ? now : row.resolved_at

    try {
      this.db
        .prepare('UPDATE gap_flags SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
        .run(status, resolvedAt, now, id)
      return Ok(rowToGapFlag({ ...row, status, resolved_at: resolvedAt, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
