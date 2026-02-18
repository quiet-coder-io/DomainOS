import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { SharedProtocolRepository } from '../../src/protocols/shared-repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: SharedProtocolRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new SharedProtocolRepository(db)
})

describe('SharedProtocolRepository', () => {
  it('creates a shared protocol', () => {
    const result = repo.create({ name: 'STOP Protocol', content: 'Stop when unsure.' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('STOP Protocol')
      expect(result.value.content).toBe('Stop when unsure.')
      expect(result.value.isEnabled).toBe(true)
      expect(result.value.scope).toBe('all')
      expect(result.value.priority).toBe(0)
    }
  })

  it('rejects duplicate names', () => {
    repo.create({ name: 'Unique', content: 'Content 1' })
    const result = repo.create({ name: 'Unique', content: 'Content 2' })
    expect(result.ok).toBe(false)
  })

  it('lists all shared protocols', () => {
    repo.create({ name: 'A', content: 'Content A', priority: 10 })
    repo.create({ name: 'B', content: 'Content B', priority: 5 })

    const result = repo.list()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(2)
      // Ordered by priority DESC
      expect(result.value[0].name).toBe('A')
      expect(result.value[1].name).toBe('B')
    }
  })

  it('lists only enabled protocols', () => {
    repo.create({ name: 'Enabled', content: 'On', isEnabled: true })
    repo.create({ name: 'Disabled', content: 'Off', isEnabled: false })

    const result = repo.listEnabled()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0].name).toBe('Enabled')
    }
  })

  it('filters by scope', () => {
    repo.create({ name: 'All', content: 'All scopes', scope: 'all' })
    repo.create({ name: 'Chat', content: 'Chat only', scope: 'chat' })
    repo.create({ name: 'Startup', content: 'Startup only', scope: 'startup' })

    const chatResult = repo.listEnabled('chat')
    expect(chatResult.ok).toBe(true)
    if (chatResult.ok) {
      expect(chatResult.value).toHaveLength(2) // 'all' + 'chat'
      const names = chatResult.value.map((p) => p.name)
      expect(names).toContain('All')
      expect(names).toContain('Chat')
    }
  })

  it('updates a shared protocol', () => {
    const created = repo.create({ name: 'Test', content: 'Original' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.update(created.value.id, { content: 'Updated' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.content).toBe('Updated')
      expect(result.value.name).toBe('Test')
    }
  })

  it('deletes a shared protocol', () => {
    const created = repo.create({ name: 'Test', content: 'Content' })
    if (!created.ok) throw new Error('setup failed')

    const result = repo.delete(created.value.id)
    expect(result.ok).toBe(true)

    const list = repo.list()
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.value).toHaveLength(0)
    }
  })

  it('toggles enabled state', () => {
    const created = repo.create({ name: 'Toggle', content: 'Content', isEnabled: true })
    if (!created.ok) throw new Error('setup failed')

    // Toggle off
    const off = repo.toggleEnabled(created.value.id)
    expect(off.ok).toBe(true)
    if (off.ok) {
      expect(off.value.isEnabled).toBe(false)
    }

    // Toggle back on
    const on = repo.toggleEnabled(created.value.id)
    expect(on.ok).toBe(true)
    if (on.ok) {
      expect(on.value.isEnabled).toBe(true)
    }
  })

  it('returns Err for non-existent protocol update', () => {
    const result = repo.update('00000000-0000-0000-0000-000000000000', { content: 'x' })
    expect(result.ok).toBe(false)
  })

  it('creates protocol with custom priority and scope', () => {
    const result = repo.create({
      name: 'Priority',
      content: 'High priority',
      priority: 100,
      scope: 'chat',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.priority).toBe(100)
      expect(result.value.scope).toBe('chat')
    }
  })
})
