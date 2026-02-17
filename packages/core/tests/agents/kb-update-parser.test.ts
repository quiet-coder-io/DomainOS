import { describe, it, expect } from 'vitest'
import { parseKBUpdates } from '../../src/agents/kb-update-parser.js'

describe('parseKBUpdates', () => {
  it('parses a valid single kb-update block', () => {
    const text = `Some text before

\`\`\`kb-update
file: tenants.md
action: update
reasoning: Added new tenant record
---
# Tenants
- John Doe
- Jane Smith
\`\`\`

Some text after`

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toEqual({
      file: 'tenants.md',
      action: 'update',
      reasoning: 'Added new tenant record',
      content: '# Tenants\n- John Doe\n- Jane Smith',
    })
  })

  it('parses multiple kb-update blocks', () => {
    const text = `\`\`\`kb-update
file: notes.md
action: create
reasoning: New file needed
---
# Notes
Initial content
\`\`\`

\`\`\`kb-update
file: old-data.md
action: delete
reasoning: No longer relevant
---
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(2)
    expect(proposals[0].file).toBe('notes.md')
    expect(proposals[0].action).toBe('create')
    expect(proposals[1].file).toBe('old-data.md')
    expect(proposals[1].action).toBe('delete')
  })

  it('returns empty array for text with no kb-update blocks', () => {
    const text = 'Just some regular text with no updates.\n\n```js\nconsole.log("hi")\n```'
    expect(parseKBUpdates(text)).toEqual([])
  })

  it('skips malformed blocks missing required fields', () => {
    const text = `\`\`\`kb-update
file: test.md
action: update
---
content here
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseKBUpdates('')).toEqual([])
  })

  it('skips blocks with invalid action', () => {
    const text = `\`\`\`kb-update
file: test.md
action: destroy
reasoning: bad action
---
content
\`\`\``

    expect(parseKBUpdates(text)).toEqual([])
  })

  it('skips blocks missing separator', () => {
    const text = `\`\`\`kb-update
file: test.md
action: create
reasoning: no separator
content without separator
\`\`\``

    expect(parseKBUpdates(text)).toEqual([])
  })
})
