import { describe, it, expect } from 'vitest'
import {
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
  SkillOutputFormatSchema,
} from '../../src/skills/schemas.js'

describe('SkillOutputFormatSchema', () => {
  it('accepts freeform', () => {
    expect(SkillOutputFormatSchema.parse('freeform')).toBe('freeform')
  })

  it('accepts structured', () => {
    expect(SkillOutputFormatSchema.parse('structured')).toBe('structured')
  })

  it('rejects invalid value', () => {
    const result = SkillOutputFormatSchema.safeParse('other')
    expect(result.success).toBe(false)
  })
})

describe('CreateSkillInputSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'My Skill',
      content: 'Do the thing.',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('My Skill')
      expect(result.data.content).toBe('Do the thing.')
      expect(result.data.description).toBe('')
      expect(result.data.outputFormat).toBe('freeform')
      expect(result.data.toolHints).toEqual([])
      expect(result.data.isEnabled).toBe(true)
      expect(result.data.sortOrder).toBe(0)
    }
  })

  it('rejects empty name', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: '',
      content: 'Some content.',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty content', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Valid Name',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('trims name', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: '  Padded Name  ',
      content: 'Content here.',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Padded Name')
    }
  })

  it('accepts toolHints as array', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      toolHints: ['gmail_search', 'gtasks_read'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.toolHints).toEqual(['gmail_search', 'gtasks_read'])
    }
  })

  it('accepts toolHints as comma-separated string', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      toolHints: 'gmail_search, gtasks_read',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.toolHints).toEqual(['gmail_search', 'gtasks_read'])
    }
  })

  it('requires valid JSON outputSchema when outputFormat is structured', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      outputFormat: 'structured',
      outputSchema: 'not-json',
    })
    expect(result.success).toBe(false)
  })

  it('requires outputSchema when outputFormat is structured', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      outputFormat: 'structured',
    })
    expect(result.success).toBe(false)
  })

  it('accepts structured with valid JSON outputSchema', () => {
    const schema = JSON.stringify({ type: 'object', properties: {} })
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      outputFormat: 'structured',
      outputSchema: schema,
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-null outputSchema for freeform', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      outputFormat: 'freeform',
      outputSchema: '{"type":"object"}',
    })
    expect(result.success).toBe(false)
  })

  it('allows null outputSchema for freeform', () => {
    const result = CreateSkillInputSchema.safeParse({
      name: 'Skill',
      content: 'Content.',
      outputFormat: 'freeform',
      outputSchema: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('UpdateSkillInputSchema', () => {
  it('rejects format flip to structured without outputSchema', () => {
    const result = UpdateSkillInputSchema.safeParse({
      outputFormat: 'structured',
    })
    expect(result.success).toBe(false)
  })

  it('accepts format flip to structured with valid outputSchema', () => {
    const result = UpdateSkillInputSchema.safeParse({
      outputFormat: 'structured',
      outputSchema: '{"type":"object"}',
    })
    expect(result.success).toBe(true)
  })

  it('rejects format flip to structured with invalid JSON outputSchema', () => {
    const result = UpdateSkillInputSchema.safeParse({
      outputFormat: 'structured',
      outputSchema: 'bad-json',
    })
    expect(result.success).toBe(false)
  })

  it('accepts partial update with just name', () => {
    const result = UpdateSkillInputSchema.safeParse({
      name: 'New Name',
    })
    expect(result.success).toBe(true)
  })

  it('rejects freeform with non-null outputSchema', () => {
    const result = UpdateSkillInputSchema.safeParse({
      outputFormat: 'freeform',
      outputSchema: '{"type":"object"}',
    })
    expect(result.success).toBe(false)
  })
})
