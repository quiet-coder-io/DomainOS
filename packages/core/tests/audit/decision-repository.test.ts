import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DecisionRepository } from '../../src/audit/decision-repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let decisionRepo: DecisionRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  decisionRepo = new DecisionRepository(db)
  const domainRepo = new DomainRepository(db)
  const domain = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!domain.ok) throw new Error('Failed to create domain')
  domainId = domain.value.id
})

describe('DecisionRepository', () => {
  it('creates a decision with active status', () => {
    const result = decisionRepo.create({
      domainId,
      decisionId: 'use-react-router',
      decision: 'Use React Router for navigation',
      rationale: 'Most popular routing library',
      downside: 'Bundle size overhead',
      revisitTrigger: 'If we switch to Next.js',
      linkedFiles: ['claude.md', 'tech-stack.md'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('active')
      expect(result.value.decisionId).toBe('use-react-router')
      expect(result.value.linkedFiles).toEqual(['claude.md', 'tech-stack.md'])
      expect(result.value.supersedesDecisionId).toBeNull()
    }
  })

  it('lists all decisions for a domain', () => {
    decisionRepo.create({ domainId, decisionId: 'dec-1', decision: 'Decision 1' })
    decisionRepo.create({ domainId, decisionId: 'dec-2', decision: 'Decision 2' })

    const result = decisionRepo.getByDomain(domainId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.length).toBe(2)
    }
  })

  it('lists only active decisions', () => {
    const dec1 = decisionRepo.create({ domainId, decisionId: 'dec-1', decision: 'Decision 1' })
    decisionRepo.create({ domainId, decisionId: 'dec-2', decision: 'Decision 2' })

    // Reject dec-1
    if (dec1.ok) {
      decisionRepo.reject(dec1.value.id)
    }

    const active = decisionRepo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (active.ok) {
      expect(active.value.length).toBe(1)
      expect(active.value[0].decisionId).toBe('dec-2')
    }
  })

  it('supersedes a decision with chain link', () => {
    const old = decisionRepo.create({
      domainId,
      decisionId: 'routing-lib',
      decision: 'Use React Router v5',
    })
    expect(old.ok).toBe(true)
    if (!old.ok) return

    const newDec = decisionRepo.supersede(old.value.id, {
      domainId,
      decisionId: 'routing-lib-v2',
      decision: 'Upgrade to React Router v6',
      rationale: 'Better data loading API',
    })
    expect(newDec.ok).toBe(true)
    if (newDec.ok) {
      expect(newDec.value.status).toBe('active')
      expect(newDec.value.supersedesDecisionId).toBe(old.value.id)
    }

    // Old should now be superseded
    const all = decisionRepo.getByDomain(domainId)
    if (all.ok) {
      const oldDec = all.value.find((d) => d.id === old.value.id)
      expect(oldDec?.status).toBe('superseded')
    }
  })

  it('rejects a decision', () => {
    const dec = decisionRepo.create({
      domainId,
      decisionId: 'bad-idea',
      decision: 'Store passwords in plaintext',
    })
    expect(dec.ok).toBe(true)
    if (!dec.ok) return

    const rejected = decisionRepo.reject(dec.value.id)
    expect(rejected.ok).toBe(true)
    if (rejected.ok) {
      expect(rejected.value.status).toBe('rejected')
    }
  })

  it('returns error for superseding non-existent decision', () => {
    const result = decisionRepo.supersede('non-existent-id', {
      domainId,
      decisionId: 'new-dec',
      decision: 'New decision',
    })
    expect(result.ok).toBe(false)
  })

  it('returns error for rejecting non-existent decision', () => {
    const result = decisionRepo.reject('non-existent-id')
    expect(result.ok).toBe(false)
  })

  it('validates required fields', () => {
    const result = decisionRepo.create({
      domainId,
      decisionId: '',
      decision: 'Missing ID',
    })
    expect(result.ok).toBe(false)
  })

  it('stores linked_files as JSON and parses back', () => {
    const result = decisionRepo.create({
      domainId,
      decisionId: 'with-files',
      decision: 'Decision with linked files',
      linkedFiles: ['a.md', 'b.md', 'c.md'],
    })
    expect(result.ok).toBe(true)

    const fetched = decisionRepo.getByDomain(domainId)
    if (fetched.ok) {
      const dec = fetched.value.find((d) => d.decisionId === 'with-files')
      expect(dec?.linkedFiles).toEqual(['a.md', 'b.md', 'c.md'])
    }
  })
})
