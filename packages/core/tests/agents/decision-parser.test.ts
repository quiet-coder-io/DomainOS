import { describe, it, expect } from 'vitest'
import { parseDecisions } from '../../src/agents/decision-parser.js'

describe('parseDecisions', () => {
  it('parses a complete decision block', () => {
    const text = `
Some chat response text.

\`\`\`decision
decision_id: use-sqlite
decision: Use SQLite for local storage
rationale: Embedded, no server needed
downside: Single-writer concurrency limit
revisit_trigger: If multi-user support is needed
linked_files: claude.md, tech-stack.md
\`\`\`

More text after.
`
    const decisions = parseDecisions(text)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].decisionId).toBe('use-sqlite')
    expect(decisions[0].decision).toBe('Use SQLite for local storage')
    expect(decisions[0].rationale).toBe('Embedded, no server needed')
    expect(decisions[0].downside).toBe('Single-writer concurrency limit')
    expect(decisions[0].revisitTrigger).toBe('If multi-user support is needed')
    expect(decisions[0].linkedFiles).toEqual(['claude.md', 'tech-stack.md'])
  })

  it('parses multiple decision blocks', () => {
    const text = `
\`\`\`decision
decision_id: dec-1
decision: First decision
\`\`\`

\`\`\`decision
decision_id: dec-2
decision: Second decision
rationale: Some reason
\`\`\`
`
    const decisions = parseDecisions(text)
    expect(decisions).toHaveLength(2)
    expect(decisions[0].decisionId).toBe('dec-1')
    expect(decisions[1].decisionId).toBe('dec-2')
    expect(decisions[1].rationale).toBe('Some reason')
  })

  it('skips blocks missing required fields', () => {
    const text = `
\`\`\`decision
decision_id: incomplete
rationale: Has rationale but no decision field
\`\`\`

\`\`\`decision
decision: Has decision but no decision_id
\`\`\`
`
    const decisions = parseDecisions(text)
    expect(decisions).toHaveLength(0)
  })

  it('handles missing optional fields', () => {
    const text = `
\`\`\`decision
decision_id: minimal
decision: Only required fields
\`\`\`
`
    const decisions = parseDecisions(text)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].rationale).toBe('')
    expect(decisions[0].downside).toBe('')
    expect(decisions[0].revisitTrigger).toBe('')
    expect(decisions[0].linkedFiles).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(parseDecisions('')).toEqual([])
    expect(parseDecisions('no decision blocks here')).toEqual([])
  })

  it('handles linked_files with various spacing', () => {
    const text = `
\`\`\`decision
decision_id: files-test
decision: Test linked files parsing
linked_files: a.md,b.md,  c.md  , d.md
\`\`\`
`
    const decisions = parseDecisions(text)
    expect(decisions[0].linkedFiles).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
  })
})
