import { describe, it, expect } from 'vitest'
import { skillToMarkdown, markdownToSkillInput } from '../../src/skills/serialization.js'
import type { Skill } from '../../src/skills/schemas.js'

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Skill',
    description: 'A test skill.',
    content: 'Step 1: Do the thing.\nStep 2: Verify.',
    outputFormat: 'freeform',
    outputSchema: null,
    toolHints: [],
    isEnabled: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('skillToMarkdown / markdownToSkillInput roundtrip', () => {
  it('roundtrips a freeform skill', () => {
    const skill = makeSkill()
    const md = skillToMarkdown(skill)
    const input = markdownToSkillInput(md)

    expect(input.name).toBe(skill.name)
    expect(input.description).toBe(skill.description)
    expect(input.content).toBe(skill.content)
    expect(input.outputFormat).toBe(skill.outputFormat)
    expect(input.toolHints).toEqual(skill.toolHints)
  })

  it('roundtrips a structured skill with outputSchema', () => {
    const schema = JSON.stringify({ type: 'object', properties: { summary: { type: 'string' } } })
    const skill = makeSkill({
      outputFormat: 'structured',
      outputSchema: schema,
      toolHints: ['gmail_search', 'gtasks_read'],
    })
    const md = skillToMarkdown(skill)
    const input = markdownToSkillInput(md)

    expect(input.name).toBe(skill.name)
    expect(input.outputFormat).toBe('structured')
    expect(input.outputSchema).toBe(schema)
    expect(input.toolHints).toEqual(['gmail_search', 'gtasks_read'])
  })
})

describe('skillToMarkdown export format', () => {
  it('has correct frontmatter structure with JSON values', () => {
    const skill = makeSkill({
      toolHints: ['gmail_search'],
      description: 'Drafts emails.',
    })
    const md = skillToMarkdown(skill)

    expect(md).toContain('---')
    expect(md).toContain('name: "Test Skill"')
    expect(md).toContain('description: "Drafts emails."')
    expect(md).toContain('outputFormat: "freeform"')
    expect(md).toContain('toolHints: ["gmail_search"]')
  })

  it('includes outputSchema fenced block for structured skills', () => {
    const schema = '{"type":"object"}'
    const skill = makeSkill({ outputFormat: 'structured', outputSchema: schema })
    const md = skillToMarkdown(skill)

    expect(md).toContain('```outputSchema')
    expect(md).toContain(schema)
    expect(md).toContain('```')
  })

  it('omits outputSchema block for freeform skills', () => {
    const skill = makeSkill()
    const md = skillToMarkdown(skill)
    expect(md).not.toContain('```outputSchema')
  })

  it('omits description when empty', () => {
    const skill = makeSkill({ description: '' })
    const md = skillToMarkdown(skill)
    expect(md).not.toContain('description:')
  })

  it('omits toolHints when empty', () => {
    const skill = makeSkill({ toolHints: [] })
    const md = skillToMarkdown(skill)
    expect(md).not.toContain('toolHints:')
  })
})

describe('markdownToSkillInput parsing', () => {
  it('parses all fields correctly', () => {
    const md = `---
name: "Email Drafter"
description: "Drafts professional emails."
outputFormat: "freeform"
toolHints: ["gmail_search", "gtasks_read"]
---

Write a concise email.`

    const input = markdownToSkillInput(md)
    expect(input.name).toBe('Email Drafter')
    expect(input.description).toBe('Drafts professional emails.')
    expect(input.outputFormat).toBe('freeform')
    expect(input.toolHints).toEqual(['gmail_search', 'gtasks_read'])
    expect(input.content).toBe('Write a concise email.')
  })

  it('handles missing optional fields (description, outputSchema, toolHints)', () => {
    const md = `---
name: "Minimal Skill"
outputFormat: "freeform"
---

Do the thing.`

    const input = markdownToSkillInput(md)
    expect(input.name).toBe('Minimal Skill')
    expect(input.description).toBe('')
    expect(input.content).toBe('Do the thing.')
    expect(input.toolHints).toEqual([])
  })

  it('rejects malformed markdown without delimiters', () => {
    expect(() => markdownToSkillInput('no frontmatter here')).toThrow(
      'missing frontmatter delimiters',
    )
  })

  it('rejects markdown with only one delimiter', () => {
    expect(() => markdownToSkillInput('---\nname: "X"\nContent only')).toThrow(
      'missing frontmatter delimiters',
    )
  })

  it('validates via schema (empty name fails)', () => {
    const md = `---
name: ""
outputFormat: "freeform"
---

Some content.`

    expect(() => markdownToSkillInput(md)).toThrow()
  })

  it('parses outputSchema fenced block for structured skills', () => {
    const schema = '{"type":"object","properties":{"result":{"type":"string"}}}'
    const md = `---
name: "Structured Skill"
outputFormat: "structured"
---

\`\`\`outputSchema
${schema}
\`\`\`

Produce the JSON output.`

    const input = markdownToSkillInput(md)
    expect(input.outputFormat).toBe('structured')
    expect(input.outputSchema).toBe(schema)
    expect(input.content).toBe('Produce the JSON output.')
  })
})
