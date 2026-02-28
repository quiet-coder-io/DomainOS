/**
 * Chat message repository — persists chat messages per domain.
 * Supports append (INSERT OR IGNORE), keyset pagination, and bulk clear.
 * Also manages conversation summaries (sticky context across history window).
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { Result } from '../common/index.js'
import { Ok, Err, DomainOSError } from '../common/index.js'

export interface PersistedChatMessage {
  id: string
  domainId: string
  role: 'user' | 'assistant'
  content: string
  status: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface ChatMessageRow {
  id: string
  domain_id: string
  role: string
  content: string
  status: string | null
  metadata: string | null
  created_at: string
}

export interface AppendResult {
  inserted: number
  skipped: number
}

function safeJsonParseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function rowToMessage(row: ChatMessageRow): PersistedChatMessage {
  return {
    id: row.id,
    domainId: row.domain_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    status: row.status,
    metadata: safeJsonParseObject(row.metadata),
    createdAt: row.created_at,
  }
}

const VALID_ROLES = new Set(['user', 'assistant'])
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T/

export class ChatMessageRepository {
  constructor(private db: Database.Database) {}

  appendMessages(
    domainId: string,
    messages: Array<{
      id: string
      role: string
      content: string
      status?: string | null
      metadata?: Record<string, unknown>
      createdAt: string
    }>,
  ): Result<AppendResult, DomainOSError> {
    for (const msg of messages) {
      if (!VALID_ROLES.has(msg.role)) {
        return Err(DomainOSError.validation(`Invalid role "${msg.role}" — must be "user" or "assistant"`))
      }
      if (!msg.createdAt || !ISO_PREFIX.test(msg.createdAt)) {
        return Err(DomainOSError.validation(`Invalid createdAt "${msg.createdAt}" — must be ISO 8601`))
      }
    }

    try {
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO chat_messages (id, domain_id, role, content, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )

      let inserted = 0

      this.db.transaction(() => {
        for (const msg of messages) {
          let metadataJson: string | null = null
          if (msg.metadata && Object.keys(msg.metadata).length > 0) {
            metadataJson = JSON.stringify({ v: 1, ...msg.metadata })
          }

          const info = stmt.run(
            msg.id,
            domainId,
            msg.role,
            msg.content,
            msg.status ?? null,
            metadataJson,
            msg.createdAt,
          )
          if (info.changes === 1) inserted++
        }
      })()

      return Ok({ inserted, skipped: messages.length - inserted })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getByDomain(
    domainId: string,
    limit = 200,
    before?: { createdAt: string; id: string },
  ): Result<PersistedChatMessage[], DomainOSError> {
    try {
      let rows: ChatMessageRow[]

      if (before) {
        rows = this.db
          .prepare(
            `SELECT * FROM chat_messages
             WHERE domain_id = ? AND ((created_at < ?) OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(domainId, before.createdAt, before.createdAt, before.id, limit) as ChatMessageRow[]
      } else {
        rows = this.db
          .prepare(
            `SELECT * FROM chat_messages
             WHERE domain_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(domainId, limit) as ChatMessageRow[]
      }

      return Ok(rows.reverse().map(rowToMessage))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  clearByDomain(domainId: string): Result<{ deleted: number }, DomainOSError> {
    try {
      const info = this.db
        .prepare('DELETE FROM chat_messages WHERE domain_id = ?')
        .run(domainId)
      return Ok({ deleted: info.changes })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  /** Count total messages for a domain. */
  countByDomain(domainId: string): number {
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE domain_id = ?')
        .get(domainId) as { cnt: number } | undefined
      return row?.cnt ?? 0
    } catch {
      return 0
    }
  }
}

// --- Conversation Summary ---

export interface ConversationSummary {
  domainId: string
  summaryText: string
  summaryVersion: number
  lastSummarizedCreatedAt: string | null
  summaryHash: string
  updatedAt: string
}

interface SummaryRow {
  domain_id: string
  summary_text: string
  summary_version: number
  last_summarized_created_at: string | null
  summary_hash: string
  updated_at: string
}

export class ConversationSummaryRepository {
  constructor(private db: Database.Database) {}

  getSummary(domainId: string): Result<ConversationSummary | null, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM conversation_summaries WHERE domain_id = ?')
        .get(domainId) as SummaryRow | undefined
      if (!row) return Ok(null)
      return Ok({
        domainId: row.domain_id,
        summaryText: row.summary_text,
        summaryVersion: row.summary_version,
        lastSummarizedCreatedAt: row.last_summarized_created_at,
        summaryHash: row.summary_hash,
        updatedAt: row.updated_at,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  setSummary(
    domainId: string,
    summaryText: string,
    lastSummarizedCreatedAt: string,
  ): Result<void, DomainOSError> {
    try {
      const hash = createHash('sha256').update(summaryText).digest('hex').slice(0, 16)

      // Check if hash unchanged — skip write
      const existing = this.db
        .prepare('SELECT summary_hash FROM conversation_summaries WHERE domain_id = ?')
        .get(domainId) as { summary_hash: string } | undefined
      if (existing && existing.summary_hash === hash) return Ok(undefined)

      const now = new Date().toISOString()
      this.db
        .prepare(`
          INSERT INTO conversation_summaries (domain_id, summary_text, summary_version, last_summarized_created_at, summary_hash, updated_at)
          VALUES (?, ?, 1, ?, ?, ?)
          ON CONFLICT(domain_id) DO UPDATE SET
            summary_text = excluded.summary_text,
            summary_version = summary_version + 1,
            last_summarized_created_at = excluded.last_summarized_created_at,
            summary_hash = excluded.summary_hash,
            updated_at = excluded.updated_at
        `)
        .run(domainId, summaryText, lastSummarizedCreatedAt, hash, now)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
