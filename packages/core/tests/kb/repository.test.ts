import { describe, it, expect, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { openDatabase } from '../../src/storage/index.js'
import { KBRepository } from '../../src/kb/repository.js'
import type { KBScannedFile } from '../../src/kb/schemas.js'

describe('KBRepository', () => {
  let repo: KBRepository
  let domainId: string

  beforeEach(() => {
    const db = openDatabase(':memory:')
    repo = new KBRepository(db)

    domainId = uuidv4()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO domains (id, name, description, kb_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(domainId, 'Test Domain', '', '/tmp/kb', now, now)
  })

  function makeScannedFile(overrides: Partial<KBScannedFile> = {}): KBScannedFile {
    return {
      relativePath: 'test.md',
      absolutePath: '/tmp/kb/test.md',
      hash: 'abc123',
      sizeBytes: 100,
      ...overrides,
    }
  }

  it('adds new files on first sync', () => {
    const files = [
      makeScannedFile({ relativePath: 'one.md', hash: 'hash1' }),
      makeScannedFile({ relativePath: 'two.md', hash: 'hash2' }),
    ]

    const result = repo.sync(domainId, files)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({ added: 2, updated: 0, deleted: 0 })
  })

  it('reports zero changes when syncing identical files', () => {
    const files = [makeScannedFile({ relativePath: 'one.md', hash: 'hash1' })]

    repo.sync(domainId, files)
    const result = repo.sync(domainId, files)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({ added: 0, updated: 0, deleted: 0 })
  })

  it('detects updated files by hash change', () => {
    const files = [makeScannedFile({ relativePath: 'one.md', hash: 'hash1' })]
    repo.sync(domainId, files)

    const updatedFiles = [makeScannedFile({ relativePath: 'one.md', hash: 'hash2' })]
    const result = repo.sync(domainId, updatedFiles)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({ added: 0, updated: 1, deleted: 0 })
  })

  it('detects deleted files', () => {
    const files = [
      makeScannedFile({ relativePath: 'one.md', hash: 'hash1' }),
      makeScannedFile({ relativePath: 'two.md', hash: 'hash2' }),
    ]
    repo.sync(domainId, files)

    const reduced = [makeScannedFile({ relativePath: 'one.md', hash: 'hash1' })]
    const result = repo.sync(domainId, reduced)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({ added: 0, updated: 0, deleted: 1 })
  })

  it('getFiles returns synced files', () => {
    const files = [
      makeScannedFile({ relativePath: 'one.md', hash: 'hash1', sizeBytes: 50 }),
      makeScannedFile({ relativePath: 'two.md', hash: 'hash2', sizeBytes: 75 }),
    ]
    repo.sync(domainId, files)

    const result = repo.getFiles(domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toHaveLength(2)
    const paths = result.value.map((f) => f.relativePath).sort()
    expect(paths).toEqual(['one.md', 'two.md'])
    expect(result.value[0].domainId).toBe(domainId)
  })

  it('getFiles returns empty array for unknown domain', () => {
    const result = repo.getFiles(uuidv4())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual([])
  })
})
