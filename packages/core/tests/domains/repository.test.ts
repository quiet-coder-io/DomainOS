import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRepository } from '../../src/domains/index.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: DomainRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new DomainRepository(db)
})

describe('DomainRepository', () => {
  it('creates a domain', () => {
    const result = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Test')
      expect(result.value.kbPath).toBe('/tmp/kb')
      expect(result.value.id).toBeDefined()
      expect(result.value.identity).toBe('')
      expect(result.value.escalationTriggers).toBe('')
    }
  })

  it('creates a domain with identity and escalation triggers', () => {
    const result = repo.create({
      name: 'RE',
      kbPath: '/tmp/kb',
      identity: 'You are a real estate expert.',
      escalationTriggers: 'Stop if amount exceeds $50k.',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.identity).toBe('You are a real estate expert.')
      expect(result.value.escalationTriggers).toBe('Stop if amount exceeds $50k.')
    }
  })

  it('gets a domain by id', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.getById(created.value.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Test')
    }
  })

  it('returns Err for missing domain', () => {
    const result = repo.getById('00000000-0000-0000-0000-000000000000')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('lists all domains', () => {
    repo.create({ name: 'A', kbPath: '/tmp/a' })
    repo.create({ name: 'B', kbPath: '/tmp/b' })

    const result = repo.list()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(2)
    }
  })

  it('updates a domain', () => {
    const created = repo.create({ name: 'Old', kbPath: '/tmp/old' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.update(created.value.id, { name: 'New' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('New')
      expect(result.value.kbPath).toBe('/tmp/old')
    }
  })

  it('updates identity field', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.update(created.value.id, { identity: 'Updated identity' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.identity).toBe('Updated identity')
    }
  })

  it('updates escalation triggers', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.update(created.value.id, { escalationTriggers: 'New triggers' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.escalationTriggers).toBe('New triggers')
    }
  })

  it('deletes a domain', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.delete(created.value.id)
    expect(result.ok).toBe(true)

    const get = repo.getById(created.value.id)
    expect(get.ok).toBe(false)
  })

  it('rejects empty name', () => {
    const result = repo.create({ name: '', kbPath: '/tmp/kb' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects empty kbPath', () => {
    const result = repo.create({ name: 'Test', kbPath: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('defaults allowGmail to false', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.allowGmail).toBe(false)
    }
  })

  it('creates a domain with allowGmail enabled', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb', allowGmail: true })
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.value.allowGmail).toBe(true)
    }
  })

  it('toggles allowGmail and persists on partial update', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')
    expect(created.value.allowGmail).toBe(false)

    // Enable allowGmail
    const toggled = repo.update(created.value.id, { allowGmail: true })
    expect(toggled.ok).toBe(true)
    if (toggled.ok) {
      expect(toggled.value.allowGmail).toBe(true)
    }

    // Update name only (omit allowGmail) — should preserve the true value
    const renamed = repo.update(created.value.id, { name: 'Renamed' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(renamed.value.name).toBe('Renamed')
      expect(renamed.value.allowGmail).toBe(true)
    }

    // Re-read from DB to verify persistence
    const reread = repo.getById(created.value.id)
    expect(reread.ok).toBe(true)
    if (reread.ok) {
      expect(reread.value.allowGmail).toBe(true)
    }
  })
})
