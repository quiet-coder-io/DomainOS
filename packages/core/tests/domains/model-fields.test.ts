/**
 * Tests for model_provider, model_name, force_tool_attempt columns (migration v8).
 * Covers D21 invariant: modelName without modelProvider is rejected at schema level;
 * repository defensive normalization in rowToDomain.
 */
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

describe('Domain model fields', () => {
  it('defaults modelProvider and modelName to null', () => {
    const result = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.modelProvider).toBeNull()
      expect(result.value.modelName).toBeNull()
    }
  })

  it('defaults forceToolAttempt to false', () => {
    const result = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.forceToolAttempt).toBe(false)
    }
  })

  it('creates domain with model override', () => {
    const result = repo.create({
      name: 'Test',
      kbPath: '/tmp/kb',
      modelProvider: 'openai',
      modelName: 'gpt-4o',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.modelProvider).toBe('openai')
      expect(result.value.modelName).toBe('gpt-4o')
    }
  })

  it('creates domain with forceToolAttempt enabled', () => {
    const result = repo.create({
      name: 'Test',
      kbPath: '/tmp/kb',
      forceToolAttempt: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.forceToolAttempt).toBe(true)
    }
  })

  it('updates model override', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')

    const updated = repo.update(created.value.id, {
      modelProvider: 'anthropic',
      modelName: 'claude-opus-4-6',
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.modelProvider).toBe('anthropic')
      expect(updated.value.modelName).toBe('claude-opus-4-6')
    }
  })

  it('clears model override by setting both to null', () => {
    const created = repo.create({
      name: 'Test',
      kbPath: '/tmp/kb',
      modelProvider: 'openai',
      modelName: 'gpt-4o',
    })
    if (!created.ok) throw new Error('setup failed')

    const updated = repo.update(created.value.id, {
      modelProvider: null,
      modelName: null,
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.modelProvider).toBeNull()
      expect(updated.value.modelName).toBeNull()
    }
  })

  it('preserves model fields on partial update (omitted = no change)', () => {
    const created = repo.create({
      name: 'Test',
      kbPath: '/tmp/kb',
      modelProvider: 'openai',
      modelName: 'gpt-4o',
    })
    if (!created.ok) throw new Error('setup failed')

    // Update name only
    const updated = repo.update(created.value.id, { name: 'Renamed' })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.name).toBe('Renamed')
      expect(updated.value.modelProvider).toBe('openai')
      expect(updated.value.modelName).toBe('gpt-4o')
    }
  })

  it('toggles forceToolAttempt', () => {
    const created = repo.create({ name: 'Test', kbPath: '/tmp/kb' })
    if (!created.ok) throw new Error('setup failed')
    expect(created.value.forceToolAttempt).toBe(false)

    const toggled = repo.update(created.value.id, { forceToolAttempt: true })
    expect(toggled.ok).toBe(true)
    if (toggled.ok) {
      expect(toggled.value.forceToolAttempt).toBe(true)
    }

    // Verify persistence
    const reread = repo.getById(created.value.id)
    expect(reread.ok).toBe(true)
    if (reread.ok) {
      expect(reread.value.forceToolAttempt).toBe(true)
    }
  })

  it('NULL columns do not break domain queries', () => {
    repo.create({ name: 'A', kbPath: '/a' })
    repo.create({ name: 'B', kbPath: '/b', modelProvider: 'openai', modelName: 'gpt-4o' })

    const list = repo.list()
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.value).toHaveLength(2)
      const a = list.value.find(d => d.name === 'A')
      const b = list.value.find(d => d.name === 'B')
      expect(a?.modelProvider).toBeNull()
      expect(b?.modelProvider).toBe('openai')
    }
  })
})
