/**
 * Skill repository — global skills for per-message procedural expertise injection.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import {
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
} from './schemas.js'
import type {
  Skill,
  CreateSkillInput,
  UpdateSkillInput,
  SkillOutputFormat,
} from './schemas.js'

interface SkillRow {
  id: string
  name: string
  description: string
  content: string
  output_format: string
  output_schema: string | null
  tool_hints: string
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToSkill(row: SkillRow): Skill {
  let toolHints: string[] = []
  try {
    toolHints = JSON.parse(row.tool_hints)
  } catch {
    toolHints = []
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    outputFormat: row.output_format as SkillOutputFormat,
    outputSchema: row.output_schema,
    toolHints,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Normalize toolHints: trim, deduplicate, remove empty strings. */
function normalizeToolHints(hints: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const h of hints) {
    const trimmed = h.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

export class SkillRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateSkillInput): Result<Skill, DomainOSError> {
    const parsed = CreateSkillInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()
    const toolHints = normalizeToolHints(parsed.data.toolHints)
    const outputSchema =
      parsed.data.outputFormat === 'freeform' ? null : (parsed.data.outputSchema ?? null)

    try {
      this.db
        .prepare(
          `INSERT INTO skills (id, name, description, content, output_format, output_schema, tool_hints, is_enabled, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.data.name,
          parsed.data.description,
          parsed.data.content,
          parsed.data.outputFormat,
          outputSchema,
          JSON.stringify(toolHints),
          parsed.data.isEnabled ? 1 : 0,
          parsed.data.sortOrder,
          now,
          now,
        )

      return Ok({
        id,
        name: parsed.data.name,
        description: parsed.data.description,
        content: parsed.data.content,
        outputFormat: parsed.data.outputFormat,
        outputSchema,
        toolHints,
        isEnabled: parsed.data.isEnabled,
        sortOrder: parsed.data.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  list(): Result<Skill[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM skills ORDER BY sort_order ASC, name ASC')
        .all() as SkillRow[]
      return Ok(rows.map(rowToSkill))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listEnabled(): Result<Skill[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM skills WHERE is_enabled = 1 ORDER BY sort_order ASC, name ASC')
        .all() as SkillRow[]
      return Ok(rows.map(rowToSkill))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<Skill, DomainOSError> {
    try {
      const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
        | SkillRow
        | undefined
      if (!row) return Err(DomainOSError.notFound('Skill', id))
      return Ok(rowToSkill(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdateSkillInput): Result<Skill, DomainOSError> {
    const parsed = UpdateSkillInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Skill', id))

    const existing = rowToSkill(row)
    const patch = parsed.data

    // Apply patch with correct semantics for outputSchema:
    // undefined = no change, null = clear it, string = set it
    const merged = applyPatch(existing, patch)

    // Validate merged state: if structured, outputSchema must be present
    if (merged.outputFormat === 'structured') {
      if (!merged.outputSchema || merged.outputSchema.trim().length === 0) {
        return Err(DomainOSError.validation('outputSchema is required when outputFormat is structured'))
      }
      try {
        JSON.parse(merged.outputSchema)
      } catch {
        return Err(DomainOSError.validation('outputSchema must be valid JSON'))
      }
    } else {
      // Freeform: clear outputSchema
      merged.outputSchema = null
    }

    const now = new Date().toISOString()
    const toolHints = normalizeToolHints(merged.toolHints)

    try {
      this.db
        .prepare(
          `UPDATE skills SET name = ?, description = ?, content = ?, output_format = ?, output_schema = ?,
           tool_hints = ?, is_enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          merged.name,
          merged.description,
          merged.content,
          merged.outputFormat,
          merged.outputSchema,
          JSON.stringify(toolHints),
          merged.isEnabled ? 1 : 0,
          merged.sortOrder,
          now,
          id,
        )

      return Ok({
        ...merged,
        toolHints,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Skill', id))

    try {
      this.db.prepare('DELETE FROM skills WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  toggleEnabled(id: string): Result<Skill, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Skill', id))

    const newEnabled = row.is_enabled === 1 ? 0 : 1
    const now = new Date().toISOString()

    try {
      this.db
        .prepare('UPDATE skills SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(newEnabled, now, id)

      return Ok(rowToSkill({ ...row, is_enabled: newEnabled, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}

/** Apply a partial patch to an existing skill, respecting undefined/null/value semantics. */
function applyPatch(
  existing: Skill,
  patch: UpdateSkillInput,
): Skill {
  return {
    id: existing.id,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    content: patch.content ?? existing.content,
    outputFormat: patch.outputFormat ?? existing.outputFormat,
    // outputSchema: undefined = no change, null = clear, string = set
    outputSchema:
      patch.outputSchema === undefined
        ? existing.outputSchema
        : patch.outputSchema,
    toolHints: patch.toolHints ?? existing.toolHints,
    isEnabled: patch.isEnabled ?? existing.isEnabled,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  }
}
