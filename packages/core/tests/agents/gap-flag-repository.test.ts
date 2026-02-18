import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { GapFlagRepository } from '../../src/agents/gap-flag-repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let gapRepo: GapFlagRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  gapRepo = new GapFlagRepository(db)
  const domainRepo = new DomainRepository(db)
  const domain = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!domain.ok) throw new Error('Failed to create domain')
  domainId = domain.value.id
})

describe('GapFlagRepository', () => {
  it('creates a gap flag with open status', () => {
    const result = gapRepo.create({
      domainId,
      category: 'missing-context',
      description: 'No vendor contact info',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('open')
      expect(result.value.category).toBe('missing-context')
      expect(result.value.resolvedAt).toBeNull()
    }
  })

  it('lists all gap flags by domain', () => {
    gapRepo.create({ domainId, category: 'missing-context', description: 'Gap 1' })
    gapRepo.create({ domainId, category: 'outdated-info', description: 'Gap 2' })

    const result = gapRepo.getByDomain(domainId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.length).toBe(2)
    }
  })

  it('lists only open gap flags', () => {
    const gap1 = gapRepo.create({ domainId, category: 'missing-context', description: 'Gap 1' })
    gapRepo.create({ domainId, category: 'outdated-info', description: 'Gap 2' })

    // Resolve gap1
    if (gap1.ok) gapRepo.resolve(gap1.value.id)

    const open = gapRepo.getOpen(domainId)
    expect(open.ok).toBe(true)
    if (open.ok) {
      expect(open.value.length).toBe(1)
      expect(open.value[0].description).toBe('Gap 2')
    }
  })

  it('acknowledges a gap flag', () => {
    const created = gapRepo.create({ domainId, category: 'assumption-made', description: 'Assumed X' })
    if (!created.ok) return

    const acked = gapRepo.acknowledge(created.value.id)
    expect(acked.ok).toBe(true)
    if (acked.ok) {
      expect(acked.value.status).toBe('acknowledged')
    }
  })

  it('resolves a gap flag with timestamp', () => {
    const created = gapRepo.create({ domainId, category: 'process-gap', description: 'No process docs' })
    if (!created.ok) return

    const resolved = gapRepo.resolve(created.value.id)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.value.status).toBe('resolved')
      expect(resolved.value.resolvedAt).not.toBeNull()
    }
  })

  it('lifecycle: open → acknowledged → resolved', () => {
    const created = gapRepo.create({ domainId, category: 'conflicting-data', description: 'Conflict' })
    if (!created.ok) return

    const acked = gapRepo.acknowledge(created.value.id)
    expect(acked.ok).toBe(true)
    if (acked.ok) expect(acked.value.status).toBe('acknowledged')

    const resolved = gapRepo.resolve(created.value.id)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.value.status).toBe('resolved')
  })

  it('returns error for non-existent gap flag', () => {
    expect(gapRepo.acknowledge('non-existent').ok).toBe(false)
    expect(gapRepo.resolve('non-existent').ok).toBe(false)
  })

  it('validates required fields', () => {
    const result = gapRepo.create({ domainId, category: '', description: 'Missing category' })
    expect(result.ok).toBe(false)
  })

  it('stores session_id', () => {
    const result = gapRepo.create({
      domainId,
      sessionId: 'test-session-id',
      category: 'missing-context',
      description: 'With session',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sessionId).toBe('test-session-id')
    }
  })
})
