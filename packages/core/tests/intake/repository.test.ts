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

  it('creates with sourceType and externalId', () => {
    const result = repo.create({
      title: 'Gmail message',
      content: 'Email body',
      sourceType: 'gmail',
      externalId: 'msg-abc-123',
      metadata: { from: 'sender@example.com', subject: 'Test', threadId: 'thread-1' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sourceType).toBe('gmail')
      expect(result.value.externalId).toBe('msg-abc-123')
      expect(result.value.metadata).toEqual({
        from: 'sender@example.com',
        subject: 'Test',
        threadId: 'thread-1',
      })
    }
  })

  it('defaults sourceType to web', () => {
    const result = repo.create({ title: 'Web Page', content: 'Page content' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sourceType).toBe('web')
      expect(result.value.externalId).toBe('')
      expect(result.value.metadata).toEqual({})
    }
  })

  it('finds item by externalId', () => {
    repo.create({
      title: 'Task item',
      content: 'Task body',
      sourceType: 'gtasks',
      externalId: 'task-xyz-789',
      metadata: { taskListId: 'list-1', due: '2026-03-01' },
    })

    const found = repo.findByExternalId('gtasks', 'task-xyz-789')
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value).not.toBeNull()
      expect(found.value!.title).toBe('Task item')
      expect(found.value!.sourceType).toBe('gtasks')
    }
  })

  it('returns null for non-existent externalId', () => {
    const found = repo.findByExternalId('gmail', 'does-not-exist')
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value).toBeNull()
    }
  })

  it('returns null for empty externalId', () => {
    const found = repo.findByExternalId('gmail', '')
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value).toBeNull()
    }
  })

  it('enforces unique external_id per source_type', () => {
    const first = repo.create({
      title: 'First',
      content: 'Content',
      sourceType: 'gmail',
      externalId: 'msg-duplicate',
    })
    expect(first.ok).toBe(true)

    const second = repo.create({
      title: 'Second',
      content: 'Content',
      sourceType: 'gmail',
      externalId: 'msg-duplicate',
    })
    expect(second.ok).toBe(false)
  })

  it('allows same externalId for different sourceTypes', () => {
    const gmail = repo.create({
      title: 'Gmail',
      content: 'Content',
      sourceType: 'gmail',
      externalId: 'same-id',
    })
    const gtasks = repo.create({
      title: 'Task',
      content: 'Content',
      sourceType: 'gtasks',
      externalId: 'same-id',
    })
    expect(gmail.ok).toBe(true)
    expect(gtasks.ok).toBe(true)
  })

  it('lists items by sourceType', () => {
    repo.create({ title: 'Web 1', content: 'Content', sourceType: 'web' })
    repo.create({ title: 'Gmail 1', content: 'Content', sourceType: 'gmail', externalId: 'g1' })
    repo.create({ title: 'Gmail 2', content: 'Content', sourceType: 'gmail', externalId: 'g2' })

    const gmailItems = repo.listBySourceType('gmail')
    expect(gmailItems.ok).toBe(true)
    if (gmailItems.ok) {
      expect(gmailItems.value).toHaveLength(2)
      expect(gmailItems.value.every((i) => i.sourceType === 'gmail')).toBe(true)
    }
  })

  it('roundtrips metadata JSON correctly', () => {
    const meta = {
      from: 'user@test.com',
      to: ['a@b.com', 'c@d.com'],
      labels: ['INBOX', 'IMPORTANT'],
      date: '2026-02-17T10:00:00Z',
      nested: { key: 'value' },
    }
    const created = repo.create({
      title: 'Rich metadata',
      content: 'Content',
      sourceType: 'gmail',
      externalId: 'meta-test',
      metadata: meta,
    })
    if (!created.ok) throw new Error('setup failed')

    const fetched = repo.getById(created.value.id)
    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.metadata).toEqual(meta)
    }
  })
})
