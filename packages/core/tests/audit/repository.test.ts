import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { AuditRepository } from '../../src/audit/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import { computeContentHash } from '../../src/audit/content-hash.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let auditRepo: AuditRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  auditRepo = new AuditRepository(db)
  const domainRepo = new DomainRepository(db)
  const domain = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!domain.ok) throw new Error('Failed to create domain')
  domainId = domain.value.id
})

describe('AuditRepository', () => {
  it('logs a KB write change', () => {
    const result = auditRepo.logChange({
      domainId,
      filePath: 'claude.md',
      changeDescription: 'Updated identity section',
      eventType: 'kb_write',
      source: 'agent',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.domainId).toBe(domainId)
      expect(result.value.filePath).toBe('claude.md')
      expect(result.value.eventType).toBe('kb_write')
      expect(result.value.source).toBe('agent')
    }
  })

  it('deduplicates by content_hash', () => {
    const hash = computeContentHash('claude.md', 'Hello world')
    const first = auditRepo.logChange({
      domainId,
      filePath: 'claude.md',
      changeDescription: 'First write',
      contentHash: hash,
      eventType: 'kb_write',
    })
    expect(first.ok).toBe(true)

    // Same hash should return existing entry, not create new
    const second = auditRepo.logChange({
      domainId,
      filePath: 'claude.md',
      changeDescription: 'Second write (duplicate)',
      contentHash: hash,
      eventType: 'kb_write',
    })
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id)
    }
  })

  it('does not dedup when content_hash differs', () => {
    const hash1 = computeContentHash('claude.md', 'Version 1')
    const hash2 = computeContentHash('claude.md', 'Version 2')
    const first = auditRepo.logChange({
      domainId,
      filePath: 'claude.md',
      changeDescription: 'Version 1',
      contentHash: hash1,
    })
    const second = auditRepo.logChange({
      domainId,
      filePath: 'claude.md',
      changeDescription: 'Version 2',
      contentHash: hash2,
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.value.id).not.toBe(first.value.id)
    }
  })

  it('lists entries by domain in descending order', () => {
    auditRepo.logChange({ domainId, filePath: 'a.md', changeDescription: 'First' })
    auditRepo.logChange({ domainId, filePath: 'b.md', changeDescription: 'Second' })

    const result = auditRepo.getByDomain(domainId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.length).toBe(2)
      // Most recent first
      expect(result.value[0].filePath).toBe('b.md')
      expect(result.value[1].filePath).toBe('a.md')
    }
  })

  it('filters by event type', () => {
    auditRepo.logChange({ domainId, filePath: 'a.md', changeDescription: 'Write', eventType: 'kb_write' })
    auditRepo.logChange({ domainId, filePath: 'sibling:X/kb_digest.md', changeDescription: 'Read', eventType: 'cross_domain_read' })

    const writes = auditRepo.getByDomainAndType(domainId, 'kb_write')
    expect(writes.ok).toBe(true)
    if (writes.ok) {
      expect(writes.value.length).toBe(1)
      expect(writes.value[0].eventType).toBe('kb_write')
    }

    const reads = auditRepo.getByDomainAndType(domainId, 'cross_domain_read')
    expect(reads.ok).toBe(true)
    if (reads.ok) {
      expect(reads.value.length).toBe(1)
      expect(reads.value[0].eventType).toBe('cross_domain_read')
    }
  })

  it('finds by content hash', () => {
    const hash = computeContentHash('test.md', 'content')
    auditRepo.logChange({ domainId, filePath: 'test.md', changeDescription: 'Test', contentHash: hash })

    const found = auditRepo.findByContentHash(domainId, hash)
    expect(found.ok).toBe(true)
    if (found.ok) {
      expect(found.value).not.toBeNull()
      expect(found.value!.filePath).toBe('test.md')
    }

    const notFound = auditRepo.findByContentHash(domainId, 'nonexistent-hash')
    expect(notFound.ok).toBe(true)
    if (notFound.ok) {
      expect(notFound.value).toBeNull()
    }
  })

  it('validates required changeDescription', () => {
    const result = auditRepo.logChange({
      domainId,
      filePath: 'a.md',
      changeDescription: '',
    })
    expect(result.ok).toBe(false)
  })

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      auditRepo.logChange({ domainId, filePath: `file-${i}.md`, changeDescription: `Change ${i}` })
    }
    const result = auditRepo.getByDomain(domainId, 3)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.length).toBe(3)
    }
  })
})
