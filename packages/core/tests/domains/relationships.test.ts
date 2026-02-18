import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRelationshipRepository } from '../../src/domains/relationships.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let relRepo: DomainRelationshipRepository
let domainRepo: DomainRepository
let domainA: string
let domainB: string
let domainC: string

beforeEach(() => {
  db = openDatabase(':memory:')
  relRepo = new DomainRelationshipRepository(db)
  domainRepo = new DomainRepository(db)

  const a = domainRepo.create({ name: 'Domain A', kbPath: '/tmp/a' })
  const b = domainRepo.create({ name: 'Domain B', kbPath: '/tmp/b' })
  const c = domainRepo.create({ name: 'Domain C', kbPath: '/tmp/c' })
  if (!a.ok || !b.ok || !c.ok) throw new Error('Failed to create test domains')
  domainA = a.value.id
  domainB = b.value.id
  domainC = c.value.id
})

describe('DomainRelationshipRepository', () => {
  it('adds a bidirectional sibling relationship', () => {
    const result = relRepo.addSibling(domainA, domainB)
    expect(result.ok).toBe(true)

    // A can see B
    const siblingsOfA = relRepo.getSiblings(domainA)
    expect(siblingsOfA.ok).toBe(true)
    if (siblingsOfA.ok) {
      expect(siblingsOfA.value.length).toBe(1)
      expect(siblingsOfA.value[0].siblingDomainId).toBe(domainB)
    }

    // B can see A (bidirectional)
    const siblingsOfB = relRepo.getSiblings(domainB)
    expect(siblingsOfB.ok).toBe(true)
    if (siblingsOfB.ok) {
      expect(siblingsOfB.value.length).toBe(1)
      expect(siblingsOfB.value[0].siblingDomainId).toBe(domainA)
    }
  })

  it('rejects self-referencing relationship', () => {
    const result = relRepo.addSibling(domainA, domainA)
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate relationship', () => {
    relRepo.addSibling(domainA, domainB)
    const duplicate = relRepo.addSibling(domainA, domainB)
    expect(duplicate.ok).toBe(false)
  })

  it('removes bidirectional relationship', () => {
    relRepo.addSibling(domainA, domainB)
    const result = relRepo.removeSibling(domainA, domainB)
    expect(result.ok).toBe(true)

    const siblingsOfA = relRepo.getSiblings(domainA)
    if (siblingsOfA.ok) expect(siblingsOfA.value.length).toBe(0)

    const siblingsOfB = relRepo.getSiblings(domainB)
    if (siblingsOfB.ok) expect(siblingsOfB.value.length).toBe(0)
  })

  it('supports multiple siblings', () => {
    relRepo.addSibling(domainA, domainB)
    relRepo.addSibling(domainA, domainC)

    const siblings = relRepo.getSiblings(domainA)
    expect(siblings.ok).toBe(true)
    if (siblings.ok) {
      expect(siblings.value.length).toBe(2)
      const siblingIds = siblings.value.map((s) => s.siblingDomainId)
      expect(siblingIds).toContain(domainB)
      expect(siblingIds).toContain(domainC)
    }
  })

  it('filters by relationship type', () => {
    relRepo.addSibling(domainA, domainB, 'sibling')
    relRepo.addSibling(domainA, domainC, 'reference')

    const siblings = relRepo.getByType(domainA, 'sibling')
    expect(siblings.ok).toBe(true)
    if (siblings.ok) {
      expect(siblings.value.length).toBe(1)
      expect(siblings.value[0].siblingDomainId).toBe(domainB)
    }

    const references = relRepo.getByType(domainA, 'reference')
    expect(references.ok).toBe(true)
    if (references.ok) {
      expect(references.value.length).toBe(1)
      expect(references.value[0].siblingDomainId).toBe(domainC)
    }
  })

  it('cascades on domain delete', () => {
    relRepo.addSibling(domainA, domainB)

    // Delete domain B
    domainRepo.delete(domainB)

    // A should have no siblings left
    const siblings = relRepo.getSiblings(domainA)
    expect(siblings.ok).toBe(true)
    if (siblings.ok) {
      expect(siblings.value.length).toBe(0)
    }
  })
})
