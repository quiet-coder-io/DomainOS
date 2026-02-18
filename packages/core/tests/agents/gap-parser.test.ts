import { describe, it, expect } from 'vitest'
import { parseGapFlags } from '../../src/agents/gap-parser.js'

describe('parseGapFlags', () => {
  it('parses a complete gap-flag block', () => {
    const text = `
Some analysis here.

\`\`\`gap-flag
category: missing-context
description: No vendor contact information found for ABC Corp
\`\`\`

More text.
`
    const flags = parseGapFlags(text)
    expect(flags).toHaveLength(1)
    expect(flags[0].category).toBe('missing-context')
    expect(flags[0].description).toBe('No vendor contact information found for ABC Corp')
  })

  it('parses multiple gap-flag blocks', () => {
    const text = `
\`\`\`gap-flag
category: outdated-info
description: Rent roll data appears to be from Q2 2024
\`\`\`

\`\`\`gap-flag
category: conflicting-data
description: KB says lease expires March but email says April
\`\`\`
`
    const flags = parseGapFlags(text)
    expect(flags).toHaveLength(2)
    expect(flags[0].category).toBe('outdated-info')
    expect(flags[1].category).toBe('conflicting-data')
  })

  it('skips blocks missing required fields', () => {
    const text = `
\`\`\`gap-flag
category: missing-context
\`\`\`

\`\`\`gap-flag
description: No category specified
\`\`\`
`
    const flags = parseGapFlags(text)
    expect(flags).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(parseGapFlags('')).toEqual([])
    expect(parseGapFlags('no gap flags here')).toEqual([])
  })

  it('handles all gap categories', () => {
    const categories = ['missing-context', 'outdated-info', 'conflicting-data', 'assumption-made', 'process-gap']
    const blocks = categories
      .map((c) => `\`\`\`gap-flag\ncategory: ${c}\ndescription: Test for ${c}\n\`\`\``)
      .join('\n\n')

    const flags = parseGapFlags(blocks)
    expect(flags).toHaveLength(5)
    flags.forEach((flag, i) => {
      expect(flag.category).toBe(categories[i])
    })
  })
})
