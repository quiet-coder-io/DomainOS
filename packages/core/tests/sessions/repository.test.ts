import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { SessionRepository } from '../../src/sessions/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let sessionRepo: SessionRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  sessionRepo = new SessionRepository(db)
  const domainRepo = new DomainRepository(db)
  const domain = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!domain.ok) throw new Error('Failed to create domain')
  domainId = domain.value.id
})

describe('SessionRepository', () => {
  it('creates a session with active status', () => {
    const result = sessionRepo.create({
      domainId,
      scope: 'working',
      modelProvider: 'anthropic',
      modelName: 'claude-sonnet',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('active')
      expect(result.value.scope).toBe('working')
      expect(result.value.modelProvider).toBe('anthropic')
      expect(result.value.endedAt).toBeNull()
    }
  })

  it('gets the active session for a domain', () => {
    sessionRepo.create({ domainId, scope: 'working' })

    const active = sessionRepo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (active.ok) {
      expect(active.value).not.toBeNull()
      expect(active.value!.status).toBe('active')
    }
  })

  it('returns null when no active session', () => {
    const active = sessionRepo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (active.ok) {
      expect(active.value).toBeNull()
    }
  })

  it('ends a session', () => {
    const created = sessionRepo.create({ domainId, scope: 'prep' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const ended = sessionRepo.end(created.value.id)
    expect(ended.ok).toBe(true)
    if (ended.ok) {
      expect(ended.value.status).toBe('wrapped_up')
      expect(ended.value.endedAt).not.toBeNull()
    }

    // Active should now be null
    const active = sessionRepo.getActive(domainId)
    if (active.ok) {
      expect(active.value).toBeNull()
    }
  })

  it('lists sessions by domain', () => {
    sessionRepo.create({ domainId, scope: 'quick' })
    sessionRepo.create({ domainId, scope: 'working' })

    const list = sessionRepo.getByDomain(domainId)
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.value.length).toBe(2)
      const scopes = list.value.map((s) => s.scope)
      expect(scopes).toContain('quick')
      expect(scopes).toContain('working')
    }
  })

  it('returns error for ending non-existent session', () => {
    const result = sessionRepo.end('non-existent-id')
    expect(result.ok).toBe(false)
  })

  it('supports all scope values', () => {
    for (const scope of ['quick', 'working', 'prep'] as const) {
      const result = sessionRepo.create({ domainId, scope })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.scope).toBe(scope)
      // End so next getActive works
      if (result.ok) sessionRepo.end(result.value.id)
    }
  })

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      const s = sessionRepo.create({ domainId, scope: 'working' })
      if (s.ok) sessionRepo.end(s.value.id)
    }
    const result = sessionRepo.getByDomain(domainId, 3)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.length).toBe(3)
    }
  })
})
