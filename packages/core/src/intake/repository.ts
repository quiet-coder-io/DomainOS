import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import {
  CreateIntakeItemInputSchema,
  MAX_INTAKE_CONTENT_BYTES,
} from './schemas.js'
import type { IntakeItem, CreateIntakeItemInput, IntakeStatus } from './schemas.js'

interface IntakeItemRow {
  id: string
  source_url: string
  title: string
  content: string
  extraction_mode: string
  content_size_bytes: number
  suggested_domain_id: string | null
  confidence: number | null
  status: string
  created_at: string
  resolved_at: string | null
}

function rowToIntakeItem(row: IntakeItemRow): IntakeItem {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    title: row.title,
    content: row.content,
    extractionMode: row.extraction_mode,
    contentSizeBytes: row.content_size_bytes,
    suggestedDomainId: row.suggested_domain_id,
    confidence: row.confidence,
    status: row.status as IntakeItem['status'],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

export class IntakeRepository {
  constructor(private db: Database.Database) {}

  create(input: CreateIntakeItemInput): Result<IntakeItem, DomainOSError> {
    const parsed = CreateIntakeItemInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.message))
    }

    const contentBytes = Buffer.byteLength(parsed.data.content, 'utf-8')
    if (contentBytes > MAX_INTAKE_CONTENT_BYTES) {
      return Err(
        DomainOSError.validation(
          `Content size ${contentBytes} bytes exceeds max ${MAX_INTAKE_CONTENT_BYTES} bytes`,
        ),
      )
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO intake_items (id, source_url, title, content, extraction_mode, content_size_bytes, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(id, parsed.data.sourceUrl, parsed.data.title, parsed.data.content, parsed.data.extractionMode, contentBytes, now)

      return Ok({
        id,
        sourceUrl: parsed.data.sourceUrl,
        title: parsed.data.title,
        content: parsed.data.content,
        extractionMode: parsed.data.extractionMode,
        contentSizeBytes: contentBytes,
        suggestedDomainId: null,
        confidence: null,
        status: 'pending' as const,
        createdAt: now,
        resolvedAt: null,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listPending(): Result<IntakeItem[], DomainOSError> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM intake_items WHERE status IN ('pending', 'classified') ORDER BY created_at DESC")
        .all() as IntakeItemRow[]
      return Ok(rows.map(rowToIntakeItem))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<IntakeItem, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM intake_items WHERE id = ?').get(id) as
      | IntakeItemRow
      | undefined

    if (!row) return Err(DomainOSError.notFound('IntakeItem', id))
    return Ok(rowToIntakeItem(row))
  }

  updateClassification(
    id: string,
    domainId: string,
    confidence: number,
  ): Result<IntakeItem, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing

    try {
      this.db
        .prepare(
          "UPDATE intake_items SET suggested_domain_id = ?, confidence = ?, status = 'classified' WHERE id = ?",
        )
        .run(domainId, confidence, id)

      return Ok({
        ...existing.value,
        suggestedDomainId: domainId,
        confidence,
        status: 'classified' as const,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  updateStatus(id: string, status: IntakeStatus): Result<IntakeItem, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing

    const resolvedAt =
      status === 'ingested' || status === 'dismissed' ? new Date().toISOString() : null

    try {
      this.db
        .prepare('UPDATE intake_items SET status = ?, resolved_at = ? WHERE id = ?')
        .run(status, resolvedAt, id)

      return Ok({
        ...existing.value,
        status,
        resolvedAt,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
