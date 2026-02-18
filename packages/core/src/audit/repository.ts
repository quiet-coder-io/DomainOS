/**
 * Audit log repository — tracks KB writes, cross-domain reads, and other events.
 * Uses content_hash for deduplication: SHA-256 of (filePath + "\n" + content).
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateAuditInputSchema } from './schemas.js'
import type { AuditEntry, CreateAuditInput, AuditEventType } from './schemas.js'

interface AuditRow {
  id: string
  domain_id: string
  session_id: string | null
  agent_name: string
  file_path: string
  change_description: string
  content_hash: string
  event_type: string
  source: string
  created_at: string
  updated_at: string
}

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    domainId: row.domain_id,
    sessionId: row.session_id,
    agentName: row.agent_name,
    filePath: row.file_path,
    changeDescription: row.change_description,
    contentHash: row.content_hash,
    eventType: row.event_type as AuditEventType,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class AuditRepository {
  constructor(private db: Database.Database) {}

  logChange(input: CreateAuditInput): Result<AuditEntry, DomainOSError> {
    const parsed = CreateAuditInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    // Dedup: skip if identical content_hash already exists for this domain + file
    if (parsed.data.contentHash) {
      const existing = this.findByContentHash(parsed.data.domainId, parsed.data.contentHash)
      if (existing.ok && existing.value) {
        return Ok(existing.value)
      }
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          'INSERT INTO audit_log (id, domain_id, session_id, agent_name, file_path, change_description, content_hash, event_type, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          parsed.data.domainId,
          parsed.data.sessionId ?? null,
          parsed.data.agentName,
          parsed.data.filePath,
          parsed.data.changeDescription,
          parsed.data.contentHash,
          parsed.data.eventType,
          parsed.data.source,
          now,
          now,
        )

      return Ok({
        id,
        domainId: parsed.data.domainId,
        sessionId: parsed.data.sessionId ?? null,
        agentName: parsed.data.agentName,
        filePath: parsed.data.filePath,
        changeDescription: parsed.data.changeDescription,
        contentHash: parsed.data.contentHash,
        eventType: parsed.data.eventType,
        source: parsed.data.source,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(domainId: string, limit = 100): Result<AuditEntry[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM audit_log WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, limit) as AuditRow[]
      return Ok(rows.map(rowToEntry))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomainAndType(domainId: string, eventType: AuditEventType, limit = 100): Result<AuditEntry[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM audit_log WHERE domain_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, eventType, limit) as AuditRow[]
      return Ok(rows.map(rowToEntry))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  findByContentHash(domainId: string, contentHash: string): Result<AuditEntry | null, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM audit_log WHERE domain_id = ? AND content_hash = ? LIMIT 1')
        .get(domainId, contentHash) as AuditRow | undefined
      return Ok(row ? rowToEntry(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
