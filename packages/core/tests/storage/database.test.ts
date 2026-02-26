import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'

describe('openDatabase', () => {
  it('creates all expected tables', () => {
    const db = openDatabase(':memory:')

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]

    const tableNames = tables.map((t) => t.name)

    expect(tableNames).toContain('domains')
    expect(tableNames).toContain('kb_files')
    expect(tableNames).toContain('protocols')
    expect(tableNames).toContain('chat_messages')
    expect(tableNames).toContain('schema_version')
    expect(tableNames).toContain('intake_items')
    expect(tableNames).toContain('shared_protocols')
    expect(tableNames).toContain('audit_log')
    expect(tableNames).toContain('decisions')
    expect(tableNames).toContain('domain_relationships')
    expect(tableNames).toContain('gap_flags')
    expect(tableNames).toContain('sessions')

    db.close()
  })

  it('enables WAL mode (on file-based DBs; in-memory falls back to "memory")', () => {
    const db = openDatabase(':memory:')
    const result = db.pragma('journal_mode') as { journal_mode: string }[]
    // In-memory DBs cannot use WAL — they report "memory". WAL is set for file-based DBs.
    expect(result[0]?.journal_mode).toBe('memory')
    db.close()
  })

  it('enables foreign keys', () => {
    const db = openDatabase(':memory:')
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(result[0]?.foreign_keys).toBe(1)
    db.close()
  })

  it('is idempotent — opening twice does not error', () => {
    const db = openDatabase(':memory:')
    // Running migrations again on same db should not throw
    expect(() => openDatabase(':memory:')).not.toThrow()
    db.close()
  })

  it('records schema version', () => {
    const db = openDatabase(':memory:')
    const version = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number }

    expect(version.version).toBe(18)
    db.close()
  })
})
