/**
 * Command repository — CRUD for plugin commands and invocation audit.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type {
  Command,
  CreateCommandInput,
  CommandInvocation,
} from './schemas.js'

interface CommandRow {
  id: string
  plugin_id: string | null
  plugin_command_key: string | null
  name: string
  canonical_slug: string
  plugin_name: string | null
  description: string
  argument_hint: string | null
  source_content: string
  content: string
  source_hash: string
  source_ref: string | null
  source_path: string | null
  removed_upstream_at: string | null
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

interface InvocationRow {
  id: string
  command_id: string
  domain_id: string
  canonical_slug: string
  plugin_version: string | null
  args_hash: string | null
  result_hash: string | null
  duration_ms: number | null
  status: string
  error_code: string | null
  invoked_at: string
}

function rowToCommand(row: CommandRow): Command {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    pluginCommandKey: row.plugin_command_key,
    name: row.name,
    canonicalSlug: row.canonical_slug,
    pluginName: row.plugin_name,
    description: row.description,
    argumentHint: row.argument_hint,
    sourceContent: row.source_content,
    content: row.content,
    sourceHash: row.source_hash,
    sourceRef: row.source_ref,
    sourcePath: row.source_path,
    removedUpstreamAt: row.removed_upstream_at,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToInvocation(row: InvocationRow): CommandInvocation {
  return {
    id: row.id,
    commandId: row.command_id,
    domainId: row.domain_id,
    canonicalSlug: row.canonical_slug,
    pluginVersion: row.plugin_version,
    argsHash: row.args_hash,
    resultHash: row.result_hash,
    durationMs: row.duration_ms,
    status: row.status as 'success' | 'blocked' | 'error',
    errorCode: row.error_code,
    invokedAt: row.invoked_at,
  }
}

export class CommandRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateCommandInput): Result<Command, DomainOSError> {
    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO commands (id, plugin_id, plugin_command_key, name, canonical_slug,
             plugin_name, description, argument_hint,
             source_content, content, source_hash,
             source_ref, source_path,
             is_enabled, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.pluginId,
          input.pluginCommandKey,
          input.name,
          input.canonicalSlug,
          input.pluginName ?? null,
          input.description ?? '',
          input.argumentHint ?? null,
          input.sourceContent,
          input.content,
          input.sourceHash,
          input.sourceRef ?? null,
          input.sourcePath ?? null,
          input.isEnabled !== false ? 1 : 0,
          input.sortOrder ?? 0,
          now,
          now,
        )

      return Ok({
        id,
        pluginId: input.pluginId,
        pluginCommandKey: input.pluginCommandKey,
        name: input.name,
        canonicalSlug: input.canonicalSlug,
        pluginName: input.pluginName ?? null,
        description: input.description ?? '',
        argumentHint: input.argumentHint ?? null,
        sourceContent: input.sourceContent,
        content: input.content,
        sourceHash: input.sourceHash,
        sourceRef: input.sourceRef ?? null,
        sourcePath: input.sourcePath ?? null,
        removedUpstreamAt: null,
        isEnabled: input.isEnabled !== false,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<Command, DomainOSError> {
    try {
      const row = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as
        | CommandRow
        | undefined
      if (!row) return Err(DomainOSError.notFound('Command', id))
      return Ok(rowToCommand(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByCanonicalSlug(slug: string): Result<Command, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM commands WHERE canonical_slug = ? COLLATE NOCASE')
        .get(slug) as CommandRow | undefined
      if (!row) return Err(DomainOSError.notFound('Command', slug))
      return Ok(rowToCommand(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listByPlugin(pluginId: string): Result<Command[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM commands WHERE plugin_id = ? ORDER BY sort_order ASC, name ASC')
        .all(pluginId) as CommandRow[]
      return Ok(rows.map(rowToCommand))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * List commands available for a domain — from globally-enabled plugins
   * that are also enabled for this domain.
   */
  listForDomain(domainId: string): Result<Command[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT c.* FROM commands c
           INNER JOIN plugins p ON c.plugin_id = p.id
           INNER JOIN plugin_domain_assoc pda ON p.id = pda.plugin_id
           WHERE p.is_enabled = 1
             AND pda.domain_id = ?
             AND pda.is_enabled = 1
             AND c.is_enabled = 1
           ORDER BY c.sort_order ASC, c.name ASC`,
        )
        .all(domainId) as CommandRow[]
      return Ok(rows.map(rowToCommand))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Compute display slugs for a domain — domain-scoped collision resolution.
   *
   * Returns Map<canonicalSlug, displaySlug> where displaySlug is the short form
   * if unambiguous within the domain, else the full canonical form.
   */
  computeDisplaySlugs(domainId: string): Result<Map<string, string>, DomainOSError> {
    const cmdsResult = this.listForDomain(domainId)
    if (!cmdsResult.ok) return cmdsResult as unknown as Result<Map<string, string>, DomainOSError>

    const slugMap = new Map<string, string>()
    const shortSlugGroups = new Map<string, string[]>()

    for (const cmd of cmdsResult.value) {
      const colonIdx = cmd.canonicalSlug.indexOf(':')
      const shortSlug = colonIdx > 0 ? cmd.canonicalSlug.slice(colonIdx + 1) : cmd.canonicalSlug

      const group = shortSlugGroups.get(shortSlug) || []
      group.push(cmd.canonicalSlug)
      shortSlugGroups.set(shortSlug, group)
    }

    for (const [shortSlug, canonicals] of shortSlugGroups) {
      if (canonicals.length === 1) {
        // Unambiguous — use short form
        slugMap.set(canonicals[0]!, shortSlug)
      } else {
        // Collision — all get canonical form
        for (const canonical of canonicals) {
          slugMap.set(canonical, canonical)
        }
      }
    }

    return Ok(slugMap)
  }

  updateContent(id: string, content: string): Result<Command, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as
      | CommandRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Command', id))

    const now = new Date().toISOString()

    try {
      this.db
        .prepare('UPDATE commands SET content = ?, updated_at = ? WHERE id = ?')
        .run(content, now, id)

      return Ok(rowToCommand({ ...row, content, updated_at: now }))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as
      | CommandRow
      | undefined
    if (!row) return Err(DomainOSError.notFound('Command', id))

    try {
      this.db.prepare('DELETE FROM commands WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Invocation audit ──

  logInvocation(input: {
    commandId: string
    domainId: string
    canonicalSlug: string
    pluginVersion?: string | null
    argsHash?: string | null
    resultHash?: string | null
    durationMs?: number | null
    status: 'success' | 'blocked' | 'error'
    errorCode?: string | null
  }): Result<CommandInvocation, DomainOSError> {
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO command_invocations (id, command_id, domain_id, canonical_slug,
             plugin_version, args_hash, result_hash, duration_ms,
             status, error_code, invoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.commandId,
          input.domainId,
          input.canonicalSlug,
          input.pluginVersion ?? null,
          input.argsHash ?? null,
          input.resultHash ?? null,
          input.durationMs ?? null,
          input.status,
          input.errorCode ?? null,
          now,
        )

      return Ok({
        id,
        commandId: input.commandId,
        domainId: input.domainId,
        canonicalSlug: input.canonicalSlug,
        pluginVersion: input.pluginVersion ?? null,
        argsHash: input.argsHash ?? null,
        resultHash: input.resultHash ?? null,
        durationMs: input.durationMs ?? null,
        status: input.status,
        errorCode: input.errorCode ?? null,
        invokedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listInvocations(commandId: string, limit = 50): Result<CommandInvocation[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          'SELECT * FROM command_invocations WHERE command_id = ? ORDER BY invoked_at DESC LIMIT ?',
        )
        .all(commandId, limit) as InvocationRow[]
      return Ok(rows.map(rowToInvocation))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
