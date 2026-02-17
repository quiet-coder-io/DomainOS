import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { IntakeRepository } from '../../src/intake/index.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: IntakeRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new IntakeRepository(db)
})

describe('IntakeRepository', () => {
  it('creates an intake item', () => {
    const result = repo.create({ title: 'Test Email', content: 'Hello world' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Test Email')
      expect(result.value.content).toBe('Hello world')
      expect(result.value.status).toBe('pending')
      expect(result.value.id).toBeDefined()
      expect(result.value.contentSizeBytes).toBeGreaterThan(0)
      expect(result.value.suggestedDomainId).toBeNull()
    }
  })

  it('creates with sourceUrl and extractionMode', () => {
    const result = repo.create({
      title: 'Gmail',
      content: 'Body text',
      sourceUrl: 'https://mail.google.com/123',
      extractionMode: 'excerpt',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sourceUrl).toBe('https://mail.google.com/123')
      expect(result.value.extractionMode).toBe('excerpt')
    }
  })

  it('rejects empty title', () => {
    const result = repo.create({ title: '', content: 'Some content' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects empty content', () => {
    const result = repo.create({ title: 'Test', content: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects content exceeding max size', () => {
    const bigContent = 'x'.repeat(101 * 1024)
    const result = repo.create({ title: 'Big', content: bigContent })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.message).toContain('exceeds max')
    }
  })

  it('gets item by id', () => {
    const created = repo.create({ title: 'Test', content: 'Content' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.getById(created.value.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Test')
    }
  })

  it('returns Err for missing item', () => {
    const result = repo.getById('00000000-0000-0000-0000-000000000000')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('lists pending items', () => {
    repo.create({ title: 'A', content: 'Content A' })
    repo.create({ title: 'B', content: 'Content B' })

    const result = repo.listPending()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(2)
    }
  })

  it('excludes ingested/dismissed from pending list', () => {
    const item = repo.create({ title: 'A', content: 'Content' })
    if (!item.ok) throw new Error('setup failed')

    repo.updateStatus(item.value.id, 'dismissed')

    const result = repo.listPending()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(0)
    }
  })

  it('updates classification', () => {
    const item = repo.create({ title: 'Test', content: 'Content' })
    if (!item.ok) throw new Error('setup failed')

    // Create a domain to reference
    db.prepare(
      "INSERT INTO domains (id, name, description, kb_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run('domain-1', 'Real Estate', '', '/tmp/kb', new Date().toISOString(), new Date().toISOString())

    const result = repo.updateClassification(item.value.id, 'domain-1', 0.85)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('classified')
      expect(result.value.suggestedDomainId).toBe('domain-1')
      expect(result.value.confidence).toBe(0.85)
    }
  })

  it('updates status to ingested with resolved timestamp', () => {
    const item = repo.create({ title: 'Test', content: 'Content' })
    if (!item.ok) throw new Error('setup failed')

    const result = repo.updateStatus(item.value.id, 'ingested')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('ingested')
      expect(result.value.resolvedAt).not.toBeNull()
    }
  })

  it('updates status to dismissed with resolved timestamp', () => {
    const item = repo.create({ title: 'Test', content: 'Content' })
    if (!item.ok) throw new Error('setup failed')

    const result = repo.updateStatus(item.value.id, 'dismissed')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('dismissed')
      expect(result.value.resolvedAt).not.toBeNull()
    }
  })
})
