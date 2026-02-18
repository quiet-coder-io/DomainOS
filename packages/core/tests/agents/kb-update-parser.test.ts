import { describe, it, expect } from 'vitest'
import { parseKBUpdates } from '../../src/agents/kb-update-parser.js'

describe('parseKBUpdates', () => {
  it('parses a valid single kb-update block with new fields', () => {
    const text = `Some text before

\`\`\`kb-update
file: tenants.md
action: update
tier: general
mode: full
basis: primary
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
      tier: 'general',
      mode: 'full',
      basis: 'primary',
      reasoning: 'Added new tenant record',
      content: '# Tenants\n- John Doe\n- Jane Smith',
      confirm: undefined,
    })
  })

  it('parses blocks with backward-compatible missing tier/mode/basis', () => {
    const text = `\`\`\`kb-update
file: notes.md
action: create
reasoning: New file needed
---
# Notes
Initial content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe('general') // inferred from filename
    expect(proposals[0].mode).toBe('full')    // default
    expect(proposals[0].basis).toBe('primary') // default
  })

  it('infers structural tier from claude.md', () => {
    const text = `\`\`\`kb-update
file: claude.md
action: update
mode: patch
reasoning: Update config
---
patch content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe('structural')
    expect(proposals[0].mode).toBe('patch')
  })

  it('rejects structural file with non-patch mode', () => {
    const text = `\`\`\`kb-update
file: claude.md
action: update
tier: structural
mode: full
reasoning: Full replace
---
new content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(0) // rejected: structural requires patch mode
  })

  it('rejects status file with patch mode', () => {
    const text = `\`\`\`kb-update
file: kb_digest.md
action: update
tier: status
mode: patch
reasoning: Patch digest
---
patched content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(0) // rejected: status does not allow patch
  })

  it('allows status file with full mode', () => {
    const text = `\`\`\`kb-update
file: kb_digest.md
action: update
tier: status
mode: full
reasoning: Update digest
---
new digest content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe('status')
    expect(proposals[0].mode).toBe('full')
  })

  it('rejects delete without confirm field', () => {
    const text = `\`\`\`kb-update
file: old-data.md
action: delete
reasoning: No longer relevant
---
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(0) // rejected: no confirm
  })

  it('accepts delete with correct confirm field', () => {
    const text = `\`\`\`kb-update
file: old-data.md
action: delete
reasoning: No longer relevant
confirm: DELETE old-data.md
---
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].action).toBe('delete')
    expect(proposals[0].confirm).toBe('DELETE old-data.md')
  })

  it('rejects delete with mismatched confirm field', () => {
    const text = `\`\`\`kb-update
file: old-data.md
action: delete
reasoning: No longer relevant
confirm: DELETE wrong-file.md
---
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
  })

  it('parses multiple kb-update blocks', () => {
    const text = `\`\`\`kb-update
file: notes.md
action: create
tier: general
mode: full
basis: user
reasoning: New file needed
---
# Notes
Initial content
\`\`\`

\`\`\`kb-update
file: kb_digest.md
action: update
tier: status
mode: append
basis: primary
reasoning: Append new info
---
- New entry
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(2)
    expect(proposals[0].file).toBe('notes.md')
    expect(proposals[0].basis).toBe('user')
    expect(proposals[1].file).toBe('kb_digest.md')
    expect(proposals[1].mode).toBe('append')
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

  it('falls back to defaults for invalid enum values', () => {
    const text = `\`\`\`kb-update
file: data.md
action: create
tier: invalid_tier
mode: invalid_mode
basis: invalid_basis
reasoning: Testing defaults
---
content
\`\`\``

    const proposals = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe('general')  // inferred from filename
    expect(proposals[0].mode).toBe('full')     // default
    expect(proposals[0].basis).toBe('primary') // default
  })
})
