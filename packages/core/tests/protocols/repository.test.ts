import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRepository } from '../../src/domains/index.js'
import { ProtocolRepository } from '../../src/protocols/index.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let domainRepo: DomainRepository
let protoRepo: ProtocolRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  domainRepo = new DomainRepository(db)
  protoRepo = new ProtocolRepository(db)

  const domain = domainRepo.create({ name: 'Test', kbPath: '/tmp/kb' })
  if (!domain.ok) throw new Error('setup failed')
  domainId = domain.value.id
})

describe('ProtocolRepository', () => {
  it('creates a protocol', () => {
    const result = protoRepo.create({
      domainId,
      name: 'Greeting',
      content: 'Always say hello',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Greeting')
      expect(result.value.sortOrder).toBe(0)
    }
  })

  it('lists protocols by domain sorted by sortOrder', () => {
    protoRepo.create({ domainId, name: 'Second', content: 'B', sortOrder: 2 })
    protoRepo.create({ domainId, name: 'First', content: 'A', sortOrder: 1 })
    protoRepo.create({ domainId, name: 'Third', content: 'C', sortOrder: 3 })

    const result = protoRepo.getByDomainId(domainId)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(3)
      expect(result.value[0]!.name).toBe('First')
      expect(result.value[1]!.name).toBe('Second')
      expect(result.value[2]!.name).toBe('Third')
    }
  })

  it('updates a protocol', () => {
    const created = protoRepo.create({
      domainId,
      name: 'Old',
      content: 'Old content',
    })
    if (!created.ok) throw new Error('setup failed')

    const result = protoRepo.update(created.value.id, { name: 'New' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('New')
      expect(result.value.content).toBe('Old content')
    }
  })

  it('deletes a protocol', () => {
    const created = protoRepo.create({
      domainId,
      name: 'Test',
      content: 'Test content',
    })
    if (!created.ok) throw new Error('setup failed')

    const result = protoRepo.delete(created.value.id)
    expect(result.ok).toBe(true)

    const list = protoRepo.getByDomainId(domainId)
    if (list.ok) expect(list.value).toHaveLength(0)
  })

  it('returns Err for missing protocol on update', () => {
    const result = protoRepo.update('00000000-0000-0000-0000-000000000000', { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('returns Err for missing protocol on delete', () => {
    const result = protoRepo.delete('00000000-0000-0000-0000-000000000000')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})
