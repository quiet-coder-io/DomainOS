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
  identity: string
  escalation_triggers: string
  allow_gmail: number
  model_provider: string | null
  model_name: string | null
  force_tool_attempt: number
  sort_order: number
  created_at: string
  updated_at: string
}

const DOMAIN_COLUMNS = 'id, name, description, kb_path, identity, escalation_triggers, allow_gmail, model_provider, model_name, force_tool_attempt, sort_order, created_at, updated_at'

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
}

function rowToDomain(row: DomainRow): Domain {
  let modelProvider = row.model_provider
  let modelName = row.model_name

  // D21 repository-level defense: if provider set but name missing, fill default
  if (modelProvider && !modelName) {
    modelName = DEFAULT_MODELS[modelProvider] ?? null
  }

  // D21 repository-level defense: if name set but provider missing, coerce both to null
  if (modelName && !modelProvider) {
    console.warn(`[DomainRepository] Domain ${row.id}: model_name set without model_provider — coercing both to null`)
    modelProvider = null
    modelName = null
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kbPath: row.kb_path,
    identity: row.identity ?? '',
    escalationTriggers: row.escalation_triggers ?? '',
    allowGmail: row.allow_gmail === 1,
    modelProvider: modelProvider as Domain['modelProvider'],
    modelName: modelName,
    forceToolAttempt: row.force_tool_attempt === 1,
    sortOrder: row.sort_order,
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
      const maxRow = this.db.prepare('SELECT MAX(sort_order) as max_order FROM domains').get() as { max_order: number | null } | undefined
      const sortOrder = (maxRow?.max_order ?? -1) + 1

      this.db
        .prepare(
          'INSERT INTO domains (id, name, description, kb_path, identity, escalation_triggers, allow_gmail, model_provider, model_name, force_tool_attempt, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          parsed.data.name,
          parsed.data.description,
          parsed.data.kbPath,
          parsed.data.identity,
          parsed.data.escalationTriggers,
          parsed.data.allowGmail ? 1 : 0,
          parsed.data.modelProvider ?? null,
          parsed.data.modelName ?? null,
          parsed.data.forceToolAttempt ? 1 : 0,
          sortOrder,
          now,
          now,
        )

      return Ok({
        id,
        name: parsed.data.name,
        description: parsed.data.description,
        kbPath: parsed.data.kbPath,
        identity: parsed.data.identity,
        escalationTriggers: parsed.data.escalationTriggers,
        allowGmail: parsed.data.allowGmail,
        modelProvider: parsed.data.modelProvider ?? null,
        modelName: parsed.data.modelName ?? null,
        forceToolAttempt: parsed.data.forceToolAttempt ?? false,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<Domain, DomainOSError> {
    const row = this.db.prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains WHERE id = ?`).get(id) as
      | DomainRow
      | undefined

    if (!row) return Err(DomainOSError.notFound('Domain', id))
    return Ok(rowToDomain(row))
  }

  list(): Result<Domain[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains ORDER BY sort_order ASC, created_at ASC`)
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
          'UPDATE domains SET name = ?, description = ?, kb_path = ?, identity = ?, escalation_triggers = ?, allow_gmail = ?, model_provider = ?, model_name = ?, force_tool_attempt = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          updated.name,
          updated.description,
          updated.kbPath,
          updated.identity,
          updated.escalationTriggers,
          updated.allowGmail ? 1 : 0,
          updated.modelProvider ?? null,
          updated.modelName ?? null,
          updated.forceToolAttempt ? 1 : 0,
          now,
          id,
        )

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

  reorder(orderedIds: string[]): Result<void, DomainOSError> {
    try {
      const stmt = this.db.prepare('UPDATE domains SET sort_order = ? WHERE id = ?')
      const txn = this.db.transaction(() => {
        orderedIds.forEach((id, i) => stmt.run(i, id))
      })
      txn()
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
