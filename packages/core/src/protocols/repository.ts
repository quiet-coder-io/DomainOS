import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateProtocolInputSchema, UpdateProtocolInputSchema } from './schemas.js'
import type { Protocol, CreateProtocolInput, UpdateProtocolInput } from './schemas.js'

interface ProtocolRow {
  id: string
  domain_id: string
  name: string
  content: string
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToProtocol(row: ProtocolRow): Protocol {
  return {
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    content: row.content,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ProtocolRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateProtocolInput): Result<Protocol, DomainOSError> {
    const parsed = CreateProtocolInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO protocols (id, domain_id, name, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, parsed.data.domainId, parsed.data.name, parsed.data.content, parsed.data.sortOrder, now, now)

      return Ok({
        id,
        domainId: parsed.data.domainId,
        name: parsed.data.name,
        content: parsed.data.content,
        sortOrder: parsed.data.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomainId(domainId: string): Result<Protocol[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM protocols WHERE domain_id = ? ORDER BY sort_order ASC')
        .all(domainId) as ProtocolRow[]
      return Ok(rows.map(rowToProtocol))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdateProtocolInput): Result<Protocol, DomainOSError> {
    const parsed = UpdateProtocolInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const row = this.db.prepare('SELECT * FROM protocols WHERE id = ?').get(id) as
      | ProtocolRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Protocol', id))

    const existing = rowToProtocol(row)
    const now = new Date().toISOString()
    const updated: Protocol = {
      ...existing,
      ...parsed.data,
      updatedAt: now,
    }

    try {
      this.db
        .prepare(
          'UPDATE protocols SET name = ?, content = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        )
        .run(updated.name, updated.content, updated.sortOrder, now, id)

      return Ok(updated)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM protocols WHERE id = ?').get(id) as
      | ProtocolRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Protocol', id))

    try {
      this.db.prepare('DELETE FROM protocols WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
