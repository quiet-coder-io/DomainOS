import { describe, it, expect } from 'vitest'
import { parseStopBlocks } from '../../src/agents/stop-parser.js'

describe('parseStopBlocks', () => {
  it('parses a complete stop block', () => {
    const text = `
I need to stop here.

\`\`\`stop
reason: This involves a financial decision that requires your approval
action_needed: Please confirm the budget allocation before I proceed
\`\`\`
`
    const stops = parseStopBlocks(text)
    expect(stops).toHaveLength(1)
    expect(stops[0].reason).toBe('This involves a financial decision that requires your approval')
    expect(stops[0].actionNeeded).toBe('Please confirm the budget allocation before I proceed')
  })

  it('parses multiple stop blocks', () => {
    const text = `
\`\`\`stop
reason: Missing authorization
action_needed: Get manager approval
\`\`\`

\`\`\`stop
reason: Conflicting requirements
action_needed: Clarify which approach to use
\`\`\`
`
    const stops = parseStopBlocks(text)
    expect(stops).toHaveLength(2)
  })

  it('handles missing action_needed (optional)', () => {
    const text = `
\`\`\`stop
reason: Cannot proceed without more context
\`\`\`
`
    const stops = parseStopBlocks(text)
    expect(stops).toHaveLength(1)
    expect(stops[0].reason).toBe('Cannot proceed without more context')
    expect(stops[0].actionNeeded).toBe('')
  })

  it('skips blocks missing required reason', () => {
    const text = `
\`\`\`stop
action_needed: Do something
\`\`\`
`
    const stops = parseStopBlocks(text)
    expect(stops).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(parseStopBlocks('')).toEqual([])
    expect(parseStopBlocks('no stop blocks')).toEqual([])
  })
})
