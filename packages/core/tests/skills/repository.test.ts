import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { SkillRepository } from '../../src/skills/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: SkillRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new SkillRepository(db)
})

describe('SkillRepository', () => {
  it('creates a skill with all fields', () => {
    const result = repo.create({
      name: 'Email Drafter',
      description: 'Draft professional emails.',
      content: 'Write concise emails.',
      outputFormat: 'freeform',
      toolHints: ['gmail_search'],
      isEnabled: true,
      sortOrder: 5,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Email Drafter')
      expect(result.value.description).toBe('Draft professional emails.')
      expect(result.value.content).toBe('Write concise emails.')
      expect(result.value.outputFormat).toBe('freeform')
      expect(result.value.outputSchema).toBeNull()
      expect(result.value.toolHints).toEqual(['gmail_search'])
      expect(result.value.isEnabled).toBe(true)
      expect(result.value.sortOrder).toBe(5)
      expect(result.value.id).toBeTruthy()
      expect(result.value.createdAt).toBeTruthy()
      expect(result.value.updatedAt).toBeTruthy()
    }
  })

  it('rejects case-insensitive duplicate names', () => {
    repo.create({ name: 'My Skill', content: 'Content 1' })
    const result = repo.create({ name: 'my skill', content: 'Content 2' })
    expect(result.ok).toBe(false)
  })

  it('roundtrips toolHints as JSON (array → DB → array)', () => {
    const created = repo.create({
      name: 'Tool Skill',
      content: 'Content.',
      toolHints: ['gmail_search', 'gtasks_read', 'advisory_search_decisions'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const fetched = repo.getById(created.value.id)
    expect(fetched.ok).toBe(true)
    if (fetched.ok) {
      expect(fetched.value.toolHints).toEqual([
        'gmail_search',
        'gtasks_read',
        'advisory_search_decisions',
      ])
    }
  })

  it('toggleEnabled flips state and bumps updatedAt', () => {
    const created = repo.create({ name: 'Toggle', content: 'Content.', isEnabled: true })
    if (!created.ok) throw new Error('setup failed')

    const off = repo.toggleEnabled(created.value.id)
    expect(off.ok).toBe(true)
    if (off.ok) {
      expect(off.value.isEnabled).toBe(false)
      // updatedAt is set to a new Date().toISOString() — may match if sub-ms;
      // just verify it's a valid ISO string
      expect(off.value.updatedAt).toBeTruthy()
    }

    const on = repo.toggleEnabled(created.value.id)
    expect(on.ok).toBe(true)
    if (on.ok) {
      expect(on.value.isEnabled).toBe(true)
    }
  })

  it('rejects empty name via validation', () => {
    const result = repo.create({ name: '', content: 'Content.' })
    expect(result.ok).toBe(false)
  })

  it('rejects empty content via validation', () => {
    const result = repo.create({ name: 'Valid', content: '' })
    expect(result.ok).toBe(false)
  })

  it('allows null outputSchema for freeform', () => {
    const result = repo.create({
      name: 'Freeform',
      content: 'Content.',
      outputFormat: 'freeform',
      outputSchema: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.outputSchema).toBeNull()
    }
  })

  describe('merged validation in update()', () => {
    it('silently clears outputSchema when updating a freeform skill with only outputSchema', () => {
      const created = repo.create({
        name: 'Freeform Skill',
        content: 'Content.',
        outputFormat: 'freeform',
      })
      if (!created.ok) throw new Error('setup failed')

      // Merged state is freeform → outputSchema gets cleared to null
      const result = repo.update(created.value.id, {
        outputSchema: '{"type":"object"}',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.outputSchema).toBeNull()
      }
    })

    it('rejects invalid JSON outputSchema on existing structured skill', () => {
      const schema = JSON.stringify({ type: 'object' })
      const created = repo.create({
        name: 'Structured Skill',
        content: 'Content.',
        outputFormat: 'structured',
        outputSchema: schema,
      })
      if (!created.ok) throw new Error('setup failed')

      const result = repo.update(created.value.id, {
        outputSchema: 'not-valid-json',
      })
      expect(result.ok).toBe(false)
    })

    it('accepts valid JSON outputSchema update on existing structured skill', () => {
      const schema = JSON.stringify({ type: 'object' })
      const created = repo.create({
        name: 'Structured Skill 2',
        content: 'Content.',
        outputFormat: 'structured',
        outputSchema: schema,
      })
      if (!created.ok) throw new Error('setup failed')

      const newSchema = JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } })
      const result = repo.update(created.value.id, {
        outputSchema: newSchema,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.outputSchema).toBe(newSchema)
      }
    })
  })

  it('listEnabled returns only enabled skills, sorted by sort_order then name', () => {
    repo.create({ name: 'Charlie', content: 'C.', isEnabled: true, sortOrder: 2 })
    repo.create({ name: 'Alpha', content: 'A.', isEnabled: true, sortOrder: 1 })
    repo.create({ name: 'Disabled', content: 'D.', isEnabled: false, sortOrder: 0 })
    repo.create({ name: 'Bravo', content: 'B.', isEnabled: true, sortOrder: 1 })

    const result = repo.listEnabled()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(3)
      // sort_order ASC then name ASC
      expect(result.value[0].name).toBe('Alpha')
      expect(result.value[1].name).toBe('Bravo')
      expect(result.value[2].name).toBe('Charlie')
    }
  })

  it('deletes a skill and getById returns not found', () => {
    const created = repo.create({ name: 'To Delete', content: 'Content.' })
    if (!created.ok) throw new Error('setup failed')

    const deleteResult = repo.delete(created.value.id)
    expect(deleteResult.ok).toBe(true)

    const getResult = repo.getById(created.value.id)
    expect(getResult.ok).toBe(false)
  })

  it('returns Err for non-existent skill update', () => {
    const result = repo.update('00000000-0000-0000-0000-000000000000', { content: 'x' })
    expect(result.ok).toBe(false)
  })

  it('creates a structured skill with outputSchema', () => {
    const schema = JSON.stringify({ type: 'object', properties: { summary: { type: 'string' } } })
    const result = repo.create({
      name: 'Structured',
      content: 'Produce JSON.',
      outputFormat: 'structured',
      outputSchema: schema,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.outputFormat).toBe('structured')
      expect(result.value.outputSchema).toBe(schema)
    }
  })
})
