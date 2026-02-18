import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { SharedProtocolRepository } from '../../src/protocols/shared-repository.js'
import { seedDefaultProtocols } from '../../src/agents/seed-defaults.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let sharedProtocolRepo: SharedProtocolRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  sharedProtocolRepo = new SharedProtocolRepository(db)
})

describe('seedDefaultProtocols', () => {
  it('seeds STOP Protocol and Gap Detection', () => {
    seedDefaultProtocols(sharedProtocolRepo)

    const all = sharedProtocolRepo.list()
    expect(all.ok).toBe(true)
    if (all.ok) {
      expect(all.value.length).toBe(2)
      const names = all.value.map((p) => p.name)
      expect(names).toContain('STOP Protocol')
      expect(names).toContain('Gap Detection')
    }
  })

  it('STOP Protocol has highest priority', () => {
    seedDefaultProtocols(sharedProtocolRepo)

    const all = sharedProtocolRepo.list()
    if (all.ok) {
      const stop = all.value.find((p) => p.name === 'STOP Protocol')
      expect(stop?.priority).toBe(100)
      expect(stop?.isEnabled).toBe(true)
      expect(stop?.scope).toBe('all')
    }
  })

  it('Gap Detection has chat scope', () => {
    seedDefaultProtocols(sharedProtocolRepo)

    const all = sharedProtocolRepo.list()
    if (all.ok) {
      const gap = all.value.find((p) => p.name === 'Gap Detection')
      expect(gap?.priority).toBe(90)
      expect(gap?.scope).toBe('chat')
    }
  })

  it('is idempotent — does not duplicate on re-run', () => {
    seedDefaultProtocols(sharedProtocolRepo)
    seedDefaultProtocols(sharedProtocolRepo)

    const all = sharedProtocolRepo.list()
    expect(all.ok).toBe(true)
    if (all.ok) {
      expect(all.value.length).toBe(2)
    }
  })
})
