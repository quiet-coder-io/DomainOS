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
})
