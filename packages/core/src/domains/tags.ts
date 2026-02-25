/**
 * Domain tags — filterable key-value metadata for domains.
 * Separate table with normalized values for case-insensitive uniqueness and filtering.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

// --- Types ---

export interface DomainTag {
  id: string
  domainId: string
  key: string
  value: string
  createdAt: string
}

export const PREDEFINED_TAG_KEYS = ['property', 'contact', 'type'] as const
export type PredefinedTagKey = (typeof PREDEFINED_TAG_KEYS)[number]

export const TagKeySchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Tag key must start with a lowercase letter and contain only a-z, 0-9, _, -')

export const TagValueSchema = z
  .string()
  .min(1)
  .max(128)
  .transform((v) => v.trim())

/** Normalize a tag value: trim whitespace + lowercase + collapse internal whitespace. */
export function normalizeTagValue(value: string): { value: string; valueNorm: string } {
  const trimmed = value.trim()
  return { value: trimmed, valueNorm: trimmed.toLowerCase().replace(/\s+/g, ' ') }
}

// --- DB Row ---

interface DomainTagRow {
  id: string
  domain_id: string
  key: string
  value: string
  value_norm: string
  created_at: string
}

function rowToTag(row: DomainTagRow): DomainTag {
  return {
    id: row.id,
    domainId: row.domain_id,
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
  }
}

// --- Repository ---

export class DomainTagRepository {
  constructor(private db: Database.Database) {}

  /**
   * Replace all tags for a domain with the given set.
   * Delete-then-insert in a transaction. Dedupes by (key, valueNorm).
   */
  setTags(domainId: string, tags: Array<{ key: string; value: string }>): void {
    const now = new Date().toISOString()

    // Dedupe by (key, valueNorm), keeping first occurrence's casing
    const seen = new Set<string>()
    const deduped: Array<{ key: string; value: string; valueNorm: string }>  = []
    for (const tag of tags) {
      const key = tag.key.trim().toLowerCase()
      const { value, valueNorm } = normalizeTagValue(tag.value)
      if (!key || !value) continue
      const dedupKey = `${key}::${valueNorm}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      deduped.push({ key, value, valueNorm })
    }

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM domain_tags WHERE domain_id = ?').run(domainId)

      const insert = this.db.prepare(
        'INSERT INTO domain_tags (id, domain_id, key, value, value_norm, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      for (const tag of deduped) {
        insert.run(uuidv4(), domainId, tag.key, tag.value, tag.valueNorm, now)
      }
    })()
  }

  /** Get all tags for a single domain. */
  getByDomain(domainId: string): DomainTag[] {
    const rows = this.db
      .prepare('SELECT id, domain_id, key, value, value_norm, created_at FROM domain_tags WHERE domain_id = ? ORDER BY key, value COLLATE NOCASE')
      .all(domainId) as DomainTagRow[]
    return rows.map(rowToTag)
  }

  /** Get all tags grouped by domain ID (plain object for IPC serialization). */
  getAllGroupedByDomain(): Record<string, DomainTag[]> {
    const rows = this.db
      .prepare('SELECT id, domain_id, key, value, value_norm, created_at FROM domain_tags ORDER BY key, value COLLATE NOCASE')
      .all() as DomainTagRow[]

    const grouped: Record<string, DomainTag[]> = {}
    for (const row of rows) {
      const tag = rowToTag(row)
      if (!grouped[tag.domainId]) grouped[tag.domainId] = []
      grouped[tag.domainId].push(tag)
    }
    return grouped
  }

  /**
   * Get distinct values for a key, with count of domains using each value.
   * Groups by value_norm, picks MIN(value) as display representative.
   */
  getDistinctValues(key: string, opts?: { limit?: number }): Array<{ value: string; count: number }> {
    const limit = opts?.limit ?? 50
    const rows = this.db
      .prepare(
        `SELECT MIN(value) AS value, COUNT(DISTINCT domain_id) AS count
         FROM domain_tags WHERE key = ?
         GROUP BY value_norm
         ORDER BY value COLLATE NOCASE ASC LIMIT ?`,
      )
      .all(key, limit) as Array<{ value: string; count: number }>
    return rows
  }

  /** Get all distinct keys currently in use. */
  getDistinctKeys(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT key FROM domain_tags ORDER BY key')
      .all() as Array<{ key: string }>
    return rows.map((r) => r.key)
  }

  /**
   * Find domain IDs matching the given filters.
   * AND across keys, OR within values of the same key.
   * Returns null if no active filters (empty object or all empty arrays).
   */
  findDomainIdsByFilters(filters: Record<string, string[]>): string[] | null {
    // Strip keys with empty arrays
    const activeKeys = Object.entries(filters).filter(([, vals]) => vals.length > 0)
    if (activeKeys.length === 0) return null

    // Build WHERE clause
    const conditions: string[] = []
    const params: unknown[] = []

    for (const [key, values] of activeKeys) {
      const placeholders = values.map(() => '?').join(', ')
      conditions.push(`(key = ? AND value_norm IN (${placeholders}))`)
      params.push(key)
      for (const val of values) {
        params.push(normalizeTagValue(val).valueNorm)
      }
    }

    const sql = `
      SELECT domain_id
      FROM domain_tags
      WHERE ${conditions.join(' OR ')}
      GROUP BY domain_id
      HAVING COUNT(DISTINCT key) = ?
    `
    params.push(activeKeys.length)

    const rows = this.db.prepare(sql).all(...params) as Array<{ domain_id: string }>
    return rows.map((r) => r.domain_id)
  }
}
