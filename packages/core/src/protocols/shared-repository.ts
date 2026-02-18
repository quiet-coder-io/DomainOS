/**
 * Shared protocol repository — protocols included in every domain's system prompt.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import {
  CreateSharedProtocolInputSchema,
  UpdateSharedProtocolInputSchema,
} from './shared-schemas.js'
import type {
  SharedProtocol,
  CreateSharedProtocolInput,
  UpdateSharedProtocolInput,
  SharedProtocolScope,
} from './shared-schemas.js'

interface SharedProtocolRow {
  id: string
  name: string
  content: string
  sort_order: number
  priority: number
  is_enabled: number
  scope: string
  created_at: string
  updated_at: string
}

function rowToSharedProtocol(row: SharedProtocolRow): SharedProtocol {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    sortOrder: row.sort_order,
    priority: row.priority,
    isEnabled: row.is_enabled === 1,
    scope: row.scope as SharedProtocolScope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SharedProtocolRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateSharedProtocolInput): Result<SharedProtocol, DomainOSError> {
    const parsed = CreateSharedProtocolInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO shared_protocols (id, name, content, sort_order, priority, is_enabled, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          parsed.data.name,
          parsed.data.content,
          parsed.data.sortOrder,
          parsed.data.priority,
          parsed.data.isEnabled ? 1 : 0,
          parsed.data.scope,
          now,
          now,
        )

      return Ok({
        id,
        name: parsed.data.name,
        content: parsed.data.content,
        sortOrder: parsed.data.sortOrder,
        priority: parsed.data.priority,
        isEnabled: parsed.data.isEnabled,
        scope: parsed.data.scope,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  list(): Result<SharedProtocol[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM shared_protocols ORDER BY priority DESC, sort_order ASC')
        .all() as SharedProtocolRow[]
      return Ok(rows.map(rowToSharedProtocol))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listEnabled(scope?: SharedProtocolScope): Result<SharedProtocol[], DomainOSError> {
    try {
      let rows: SharedProtocolRow[]
      if (scope && scope !== 'all') {
        rows = this.db
          .prepare(
            "SELECT * FROM shared_protocols WHERE is_enabled = 1 AND (scope = 'all' OR scope = ?) ORDER BY priority DESC, sort_order ASC",
          )
          .all(scope) as SharedProtocolRow[]
      } else {
        rows = this.db
          .prepare('SELECT * FROM shared_protocols WHERE is_enabled = 1 ORDER BY priority DESC, sort_order ASC')
          .all() as SharedProtocolRow[]
      }
      return Ok(rows.map(rowToSharedProtocol))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdateSharedProtocolInput): Result<SharedProtocol, DomainOSError> {
    const parsed = UpdateSharedProtocolInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const row = this.db.prepare('SELECT * FROM shared_protocols WHERE id = ?').get(id) as
      | SharedProtocolRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('SharedProtocol', id))

    const existing = rowToSharedProtocol(row)
    const now = new Date().toISOString()
    const updated: SharedProtocol = {
      ...existing,
      ...parsed.data,
      updatedAt: now,
    }

    try {
      this.db
        .prepare(
          'UPDATE shared_protocols SET name = ?, content = ?, sort_order = ?, priority = ?, is_enabled = ?, scope = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          updated.name,
          updated.content,
          updated.sortOrder,
          updated.priority,
          updated.isEnabled ? 1 : 0,
          updated.scope,
          now,
          id,
        )

      return Ok(updated)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM shared_protocols WHERE id = ?').get(id) as
      | SharedProtocolRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('SharedProtocol', id))

    try {
      this.db.prepare('DELETE FROM shared_protocols WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  toggleEnabled(id: string): Result<SharedProtocol, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM shared_protocols WHERE id = ?').get(id) as
      | SharedProtocolRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('SharedProtocol', id))

    const newEnabled = row.is_enabled === 1 ? 0 : 1
    const now = new Date().toISOString()

    try {
      this.db
        .prepare('UPDATE shared_protocols SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(newEnabled, now, id)

      return Ok(rowToSharedProtocol({ ...row, is_enabled: newEnabled, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
