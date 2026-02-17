import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateDomainInputSchema, UpdateDomainInputSchema } from './schemas.js'
import type { Domain, CreateDomainInput, UpdateDomainInput } from './schemas.js'

interface DomainRow {
  id: string
  name: string
  description: string
  kb_path: string
  created_at: string
  updated_at: string
}

function rowToDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kbPath: row.kb_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class DomainRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateDomainInput): Result<Domain, DomainOSError> {
    const parsed = CreateDomainInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO domains (id, name, description, kb_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, parsed.data.name, parsed.data.description, parsed.data.kbPath, now, now)

      return Ok({
        id,
        name: parsed.data.name,
        description: parsed.data.description,
        kbPath: parsed.data.kbPath,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<Domain, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as
      | DomainRow
      | undefined

    if (!row) return Err(DomainOSError.notFound('Domain', id))
    return Ok(rowToDomain(row))
  }

  list(): Result<Domain[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM domains ORDER BY created_at DESC')
        .all() as DomainRow[]
      return Ok(rows.map(rowToDomain))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdateDomainInput): Result<Domain, DomainOSError> {
    const parsed = UpdateDomainInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    const updated = {
      ...existing.value,
      ...parsed.data,
      updatedAt: now,
    }

    try {
      this.db
        .prepare(
          'UPDATE domains SET name = ?, description = ?, kb_path = ?, updated_at = ? WHERE id = ?',
        )
        .run(updated.name, updated.description, updated.kbPath, now, id)

      return Ok(updated)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing as unknown as Result<void, DomainOSError>

    try {
      this.db.prepare('DELETE FROM domains WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
