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
  plugin_id: string | null
  created_at: string
  updated_at: string
}

/** View type for Skill Library — extends Skill with JOIN-derived plugin metadata. */
export interface SkillListItem extends Skill {
  pluginName: string | null
  pluginIsEnabledGlobal: boolean | null
  pluginIsEnabledForDomain: boolean | null
  removedUpstreamAt: string | null
}

interface SkillMetaRow extends SkillRow {
  plugin_name: string | null
  plugin_is_enabled_global: number | null
  plugin_is_enabled_for_domain: number | null
  removed_upstream_at: string | null
}

function rowToSkillListItem(row: SkillMetaRow): SkillListItem {
  return {
    ...rowToSkill(row),
    pluginName: row.plugin_name ?? null,
    pluginIsEnabledGlobal: row.plugin_is_enabled_global != null ? row.plugin_is_enabled_global === 1 : null,
    pluginIsEnabledForDomain: row.plugin_is_enabled_for_domain != null ? row.plugin_is_enabled_for_domain === 1 : null,
    removedUpstreamAt: row.removed_upstream_at ?? null,
  }
}

export type EffectiveSkillReason =
  | 'OK'
  | 'SKILL_DISABLED'
  | 'PLUGIN_MISSING'
  | 'PLUGIN_DISABLED_GLOBAL'
  | 'PLUGIN_DISABLED_DOMAIN'

export interface EffectiveSkillResult {
  skill: Skill
  effectiveEnabled: boolean
  reason: EffectiveSkillReason
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
    pluginId: row.plugin_id ?? null,
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
        pluginId: null,
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

  /** List all skills with plugin metadata for the Skill Library UI. */
  listWithMeta(domainId?: string): Result<SkillListItem[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT s.*,
             p.name AS plugin_name,
             p.is_enabled AS plugin_is_enabled_global,
             ${domainId ? 'pda.is_enabled AS plugin_is_enabled_for_domain' : 'NULL AS plugin_is_enabled_for_domain'}
           FROM skills s
           LEFT JOIN plugins p ON s.plugin_id = p.id
           ${domainId ? 'LEFT JOIN plugin_domain_assoc pda ON pda.plugin_id = s.plugin_id AND pda.domain_id = ?' : ''}
           ORDER BY s.sort_order ASC, s.name ASC`,
        )
        .all(...(domainId ? [domainId] : [])) as SkillMetaRow[]
      return Ok(rows.map(rowToSkillListItem))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listEnabled(): Result<Skill[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT s.* FROM skills s
           LEFT JOIN plugins p ON s.plugin_id = p.id
           WHERE s.is_enabled = 1
             AND (s.plugin_id IS NULL OR (p.id IS NOT NULL AND p.is_enabled = 1))
           ORDER BY s.sort_order ASC, s.name ASC`,
        )
        .all() as SkillRow[]
      return Ok(rows.map(rowToSkill))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listEnabledForDomain(domainId: string): Result<Skill[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT s.* FROM skills s
           LEFT JOIN plugins p ON s.plugin_id = p.id
           LEFT JOIN plugin_domain_assoc pda
             ON pda.plugin_id = s.plugin_id AND pda.domain_id = ?
           WHERE s.is_enabled = 1
             AND (
               s.plugin_id IS NULL
               OR (p.id IS NOT NULL AND p.is_enabled = 1 AND COALESCE(pda.is_enabled, 1) = 1)
             )
           ORDER BY s.sort_order ASC, s.name ASC`,
        )
        .all(domainId) as SkillRow[]
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

  getEffectiveEnabled(skillId: string, domainId: string): Result<EffectiveSkillResult, DomainOSError> {
    try {
      const row = this.db
        .prepare(
          `SELECT s.*,
             CASE
               WHEN s.is_enabled != 1 THEN 'SKILL_DISABLED'
               WHEN s.plugin_id IS NULL THEN 'OK'
               WHEN p.id IS NULL THEN 'PLUGIN_MISSING'
               WHEN p.is_enabled != 1 THEN 'PLUGIN_DISABLED_GLOBAL'
               WHEN COALESCE(pda.is_enabled, 1) != 1 THEN 'PLUGIN_DISABLED_DOMAIN'
               ELSE 'OK'
             END AS effective_reason
           FROM skills s
           LEFT JOIN plugins p ON p.id = s.plugin_id
           LEFT JOIN plugin_domain_assoc pda
             ON pda.plugin_id = s.plugin_id AND pda.domain_id = ?
           WHERE s.id = ?
           LIMIT 1`,
        )
        .get(domainId, skillId) as (SkillRow & { effective_reason: EffectiveSkillReason }) | undefined

      if (!row) return Err(DomainOSError.notFound('Skill', skillId))

      const reason = row.effective_reason
      return Ok({
        skill: rowToSkill(row),
        effectiveEnabled: reason === 'OK',
        reason,
      })
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
    pluginId: existing.pluginId,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  }
}
