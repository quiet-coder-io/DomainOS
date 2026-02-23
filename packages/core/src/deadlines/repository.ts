/**
 * Deadline repository — CRUD + query operations for deadline tracking.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateDeadlineInputSchema } from './schemas.js'
import type { Deadline, DeadlineStatus } from './schemas.js'
import { todayISO } from './evaluation.js'

// ── Row mapping ──

interface DeadlineRow {
  id: string
  domain_id: string
  text: string
  due_date: string
  priority: number
  status: string
  source: string
  source_ref: string
  snoozed_until: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

function rowToDeadline(row: DeadlineRow): Deadline {
  return {
    id: row.id,
    domainId: row.domain_id,
    text: row.text,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status as Deadline['status'],
    source: row.source as Deadline['source'],
    sourceRef: row.source_ref,
    snoozedUntil: row.snoozed_until,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Repository ──

export class DeadlineRepository {
  constructor(private db: Database.Database) {}

  create(input: unknown): Result<Deadline, DomainOSError> {
    const parsed = CreateDeadlineInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const data = parsed.data
    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO deadlines (id, domain_id, text, due_date, priority, status, source, source_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        )
        .run(id, data.domainId, data.text, data.dueDate, data.priority, data.source, data.sourceRef, now, now)

      return Ok({
        id,
        domainId: data.domainId,
        text: data.text,
        dueDate: data.dueDate,
        priority: data.priority,
        status: 'active',
        source: data.source,
        sourceRef: data.sourceRef,
        snoozedUntil: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(
    domainId: string,
    opts?: { status?: DeadlineStatus },
  ): Result<Deadline[], DomainOSError> {
    try {
      let sql = 'SELECT * FROM deadlines WHERE domain_id = ?'
      const params: unknown[] = [domainId]

      if (opts?.status) {
        sql += ' AND status = ?'
        params.push(opts.status)
      }

      sql += ' ORDER BY due_date ASC'

      const rows = this.db.prepare(sql).all(...params) as DeadlineRow[]
      return Ok(rows.map(rowToDeadline))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getActive(domainId: string): Result<Deadline[], DomainOSError> {
    return this.getByDomain(domainId, { status: 'active' })
  }

  /**
   * Get overdue deadlines: active + due_date < today.
   * If domainId is undefined, returns overdue across all domains.
   */
  getOverdue(domainId?: string, today?: string): Result<Deadline[], DomainOSError> {
    const t = today ?? todayISO()
    try {
      let sql = "SELECT * FROM deadlines WHERE status = 'active' AND due_date < ?"
      const params: unknown[] = [t]

      if (domainId) {
        sql += ' AND domain_id = ?'
        params.push(domainId)
      }

      sql += ' ORDER BY due_date ASC'

      const rows = this.db.prepare(sql).all(...params) as DeadlineRow[]
      return Ok(rows.map(rowToDeadline))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /** Active deadlines due within next N days (inclusive of today). */
  getUpcoming(domainId: string, days: number, today?: string): Result<Deadline[], DomainOSError> {
    const t = today ?? todayISO()
    const endDate = new Date(new Date(t + 'T00:00:00Z').getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10)

    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM deadlines WHERE domain_id = ? AND status = 'active' AND due_date >= ? AND due_date <= ? ORDER BY due_date ASC",
        )
        .all(domainId, t, endDate) as DeadlineRow[]
      return Ok(rows.map(rowToDeadline))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  snooze(id: string, until: string): Result<Deadline, DomainOSError> {
    if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return Err(DomainOSError.validation('Snooze date is required and must be YYYY-MM-DD'))
    }

    const row = this.db.prepare('SELECT * FROM deadlines WHERE id = ?').get(id) as DeadlineRow | undefined
    if (!row) return Err(DomainOSError.notFound('Deadline', id))

    const now = new Date().toISOString()
    try {
      this.db
        .prepare("UPDATE deadlines SET status = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?")
        .run(until, now, id)
      return Ok(rowToDeadline({ ...row, status: 'snoozed', snoozed_until: until, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  complete(id: string): Result<Deadline, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM deadlines WHERE id = ?').get(id) as DeadlineRow | undefined
    if (!row) return Err(DomainOSError.notFound('Deadline', id))

    const now = new Date().toISOString()
    try {
      this.db
        .prepare("UPDATE deadlines SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id)
      return Ok(rowToDeadline({ ...row, status: 'completed', completed_at: now, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  cancel(id: string): Result<Deadline, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM deadlines WHERE id = ?').get(id) as DeadlineRow | undefined
    if (!row) return Err(DomainOSError.notFound('Deadline', id))

    const now = new Date().toISOString()
    try {
      this.db
        .prepare("UPDATE deadlines SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id)
      return Ok(rowToDeadline({ ...row, status: 'cancelled', cancelled_at: now, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Bulk wake: unsnooze all deadlines whose snoozed_until date has passed.
   * Returns count of deadlines woken.
   */
  unsnoozeDue(today?: string): Result<number, DomainOSError> {
    const t = today ?? todayISO()
    try {
      const now = new Date().toISOString()
      const result = this.db
        .prepare(
          "UPDATE deadlines SET status = 'active', snoozed_until = NULL, updated_at = ? WHERE status = 'snoozed' AND snoozed_until <= ?",
        )
        .run(now, t)
      return Ok(result.changes)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /** Find by sourceRef within a domain — used for duplicate prevention. */
  findBySourceRef(domainId: string, sourceRef: string): Result<Deadline | null, DomainOSError> {
    try {
      const row = this.db
        .prepare("SELECT * FROM deadlines WHERE domain_id = ? AND source_ref = ? AND source_ref <> ''")
        .get(domainId, sourceRef) as DeadlineRow | undefined
      return Ok(row ? rowToDeadline(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
