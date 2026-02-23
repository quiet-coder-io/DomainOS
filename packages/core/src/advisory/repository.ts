/**
 * Advisory artifact repository — persists strategic outputs (brainstorms, risk assessments, etc.).
 * Supports fingerprint dedup, layered rate limiting, and archive lifecycle.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateAdvisoryArtifactInputSchema } from './schemas.js'
import type { AdvisoryArtifact, CreateAdvisoryArtifactInput, AdvisoryType, AdvisoryStatus } from './schemas.js'

// ── Constants ──

export const ADVISORY_MAX_DAILY_ARTIFACTS = 20
export const MAX_ARTIFACTS_PER_HOUR = 10

// ── DB Row type ──

interface AdvisoryArtifactRow {
  id: string
  domain_id: string
  session_id: string | null
  type: string
  title: string
  llm_title: string
  schema_version: number
  content: string
  fingerprint: string
  source: string
  source_message_id: string | null
  status: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

function rowToArtifact(row: AdvisoryArtifactRow): AdvisoryArtifact {
  return {
    id: row.id,
    domainId: row.domain_id,
    sessionId: row.session_id,
    type: row.type as AdvisoryType,
    title: row.title,
    llmTitle: row.llm_title,
    schemaVersion: row.schema_version,
    content: row.content,
    fingerprint: row.fingerprint,
    source: row.source as 'llm' | 'user' | 'import',
    sourceMessageId: row.source_message_id,
    status: row.status as AdvisoryStatus,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class AdvisoryRepository {
  constructor(private db: Database.Database) {}

  /**
   * Create a new advisory artifact.
   * Order: fingerprint dedup → rate limits (source='llm') → insert.
   */
  create(input: CreateAdvisoryArtifactInput): Result<AdvisoryArtifact, DomainOSError> {
    const parsed = CreateAdvisoryArtifactInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const data = parsed.data

    // 1. Fingerprint dedup check first (bypasses rate limits)
    if (data.fingerprint) {
      const existing = this.findByFingerprint(data.domainId, data.fingerprint)
      if (existing.ok && existing.value) {
        // Idempotent success — return existing artifact
        if (existing.value.status !== data.status) {
          console.warn(
            `[advisory-repo] duplicate_fingerprint_conflict existing=${existing.value.status} new=${data.status} fingerprint=${data.fingerprint.slice(0, 8)}`,
          )
        }
        return Ok(existing.value)
      }
    }

    // 2. Rate limit checks (source='llm' only)
    if (data.source === 'llm') {
      const hourCount = this.countThisHourByDomain(data.domainId)
      if (hourCount.ok && hourCount.value >= MAX_ARTIFACTS_PER_HOUR) {
        return Err(DomainOSError.validation(
          `[Advisory] Not saved to Strategic History: hourly save limit reached for this domain (${MAX_ARTIFACTS_PER_HOUR}/hour).`,
        ))
      }

      const dayCount = this.countTodayByDomain(data.domainId)
      if (dayCount.ok && dayCount.value >= ADVISORY_MAX_DAILY_ARTIFACTS) {
        return Err(DomainOSError.validation(
          `[Advisory] Not saved to Strategic History: daily save limit reached for this domain (${ADVISORY_MAX_DAILY_ARTIFACTS}/day).`,
        ))
      }
    }

    // 3. Insert
    const now = new Date().toISOString()
    const id = uuidv4()
    const archivedAt = data.archivedAt ?? (data.status === 'archived' ? now : null)

    try {
      this.db
        .prepare(
          `INSERT INTO advisory_artifacts (
            id, domain_id, session_id, type, title, llm_title, schema_version,
            content, fingerprint, source, source_message_id, status, archived_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.domainId,
          data.sessionId ?? null,
          data.type,
          data.title,
          data.title, // llm_title = title on insert (provenance)
          data.schemaVersion,
          data.content,
          data.fingerprint,
          data.source,
          data.sourceMessageId ?? null,
          data.status,
          archivedAt,
          now,
          now,
        )

      return Ok({
        id,
        domainId: data.domainId,
        sessionId: data.sessionId ?? null,
        type: data.type,
        title: data.title,
        llmTitle: data.title,
        schemaVersion: data.schemaVersion,
        content: data.content,
        fingerprint: data.fingerprint,
        source: data.source,
        sourceMessageId: data.sourceMessageId ?? null,
        status: data.status,
        archivedAt,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      const msg = (e as Error).message
      // Handle unique constraint on fingerprint (race condition fallback)
      if (msg.includes('UNIQUE constraint failed') && data.fingerprint) {
        const existing = this.findByFingerprint(data.domainId, data.fingerprint)
        if (existing.ok && existing.value) return Ok(existing.value)
      }
      return Err(DomainOSError.db(msg))
    }
  }

  getById(id: string): Result<AdvisoryArtifact, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM advisory_artifacts WHERE id = ?')
        .get(id) as AdvisoryArtifactRow | undefined
      if (!row) return Err(DomainOSError.notFound('AdvisoryArtifact', id))
      return Ok(rowToArtifact(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(
    domainId: string,
    options?: { status?: AdvisoryStatus; type?: AdvisoryType; limit?: number },
  ): Result<AdvisoryArtifact[], DomainOSError> {
    try {
      const conditions = ['domain_id = ?']
      const params: unknown[] = [domainId]

      if (options?.status) {
        conditions.push('status = ?')
        params.push(options.status)
      }
      if (options?.type) {
        conditions.push('type = ?')
        params.push(options.type)
      }

      const limit = options?.limit ?? 100
      params.push(limit)

      const sql = `SELECT * FROM advisory_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
      const rows = this.db.prepare(sql).all(...params) as AdvisoryArtifactRow[]
      return Ok(rows.map(rowToArtifact))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  archive(id: string): Result<AdvisoryArtifact, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    try {
      this.db
        .prepare("UPDATE advisory_artifacts SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id)
      return Ok({ ...existing.value, status: 'archived', archivedAt: now, updatedAt: now })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  unarchive(id: string): Result<AdvisoryArtifact, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    try {
      this.db
        .prepare("UPDATE advisory_artifacts SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ?")
        .run(now, id)
      return Ok({ ...existing.value, status: 'active', archivedAt: null, updatedAt: now })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  renameTitle(id: string, title: string): Result<AdvisoryArtifact, DomainOSError> {
    if (!title || title.length < 4 || title.length > 120) {
      return Err(DomainOSError.validation('Title must be 4-120 characters'))
    }

    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    try {
      this.db
        .prepare('UPDATE advisory_artifacts SET title = ?, updated_at = ? WHERE id = ?')
        .run(title, now, id)
      return Ok({ ...existing.value, title, updatedAt: now })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  findByFingerprint(domainId: string, fingerprint: string): Result<AdvisoryArtifact | null, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM advisory_artifacts WHERE domain_id = ? AND fingerprint = ?')
        .get(domainId, fingerprint) as AdvisoryArtifactRow | undefined
      return Ok(row ? rowToArtifact(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Count artifacts created today for this domain.
   * "Today" = calendar day in user's system timezone.
   */
  countTodayByDomain(domainId: string): Result<number, DomainOSError> {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const now = new Date()
      // Get start of today in user's timezone
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD format
      const startOfDay = new Date(`${todayStr}T00:00:00`)
      // Convert to ISO for comparison
      const startIso = startOfDay.toISOString()

      const result = this.db
        .prepare('SELECT COUNT(*) as count FROM advisory_artifacts WHERE domain_id = ? AND created_at >= ?')
        .get(domainId, startIso) as { count: number }
      return Ok(result.count)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /**
   * Count artifacts created in the last hour for this domain.
   * Uses UTC sliding window (timezone irrelevant for hours).
   */
  countThisHourByDomain(domainId: string): Result<number, DomainOSError> {
    try {
      const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
      const result = this.db
        .prepare('SELECT COUNT(*) as count FROM advisory_artifacts WHERE domain_id = ? AND created_at >= ?')
        .get(domainId, oneHourAgo) as { count: number }
      return Ok(result.count)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
