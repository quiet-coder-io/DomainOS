import { describe, it, expect } from 'vitest'
import { parseKBUpdates, parseKBUpdatesCompat, REJECTION_REASONS } from '../../src/agents/kb-update-parser.js'

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

    const { proposals } = parseKBUpdates(text)
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

    const { proposals } = parseKBUpdates(text)
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

    const { proposals } = parseKBUpdates(text)
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

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.STRUCTURAL_REQUIRES_PATCH)
    expect(rejectedProposals[0].suggestedFix).toBe('Change mode to patch.')
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

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.STATUS_NO_PATCH)
    expect(rejectedProposals[0].suggestedFix).toContain('full or append')
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

    const { proposals } = parseKBUpdates(text)
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

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.DELETE_NEEDS_CONFIRM)
    expect(rejectedProposals[0].suggestedFix).toContain('old-data.md')
  })

  it('accepts delete with correct confirm field', () => {
    const text = `\`\`\`kb-update
file: old-data.md
action: delete
reasoning: No longer relevant
confirm: DELETE old-data.md
---
\`\`\``

    const { proposals } = parseKBUpdates(text)
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

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.DELETE_NEEDS_CONFIRM)
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

    const { proposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(2)
    expect(proposals[0].file).toBe('notes.md')
    expect(proposals[0].basis).toBe('user')
    expect(proposals[1].file).toBe('kb_digest.md')
    expect(proposals[1].mode).toBe('append')
  })

  it('returns empty arrays for text with no kb-update blocks', () => {
    const text = 'Just some regular text with no updates.\n\n```js\nconsole.log("hi")\n```'
    const result = parseKBUpdates(text)
    expect(result.proposals).toEqual([])
    expect(result.rejectedProposals).toEqual([])
  })

  it('skips malformed blocks missing required fields (no file, no action) — NOT in rejected', () => {
    const text = `\`\`\`kb-update
something: test.md
---
content here
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toEqual([]) // no file: → ignore, not reject
  })

  it('rejects blocks with file: but missing action:', () => {
    const text = `\`\`\`kb-update
file: test.md
---
content here
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.MISSING_FIELDS)
    expect(rejectedProposals[0].file).toBe('test.md')
  })

  it('rejects blocks with file: but missing reasoning:', () => {
    const text = `\`\`\`kb-update
file: test.md
action: update
---
content here
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.MISSING_FIELDS)
  })

  it('returns empty result for empty string', () => {
    const result = parseKBUpdates('')
    expect(result.proposals).toEqual([])
    expect(result.rejectedProposals).toEqual([])
  })

  it('rejects blocks with invalid action', () => {
    const text = `\`\`\`kb-update
file: test.md
action: destroy
reasoning: bad action
---
content
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.invalidAction('destroy'))
  })

  it('skips blocks missing separator when no file: is present', () => {
    const text = `\`\`\`kb-update
action: create
reasoning: no separator
content without separator
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toEqual([]) // no file: → ignore
  })

  it('rejects blocks with file: but missing separator', () => {
    const text = `\`\`\`kb-update
file: test.md
action: create
reasoning: no separator
content without separator
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toEqual([])
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.MISSING_FIELDS)
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

    const { proposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].tier).toBe('general')  // inferred from filename
    expect(proposals[0].mode).toBe('full')     // default
    expect(proposals[0].basis).toBe('primary') // default
  })

  // --- New tests for rejected proposals ---

  it('mixed valid + invalid → both proposals and rejectedProposals populated', () => {
    const text = `\`\`\`kb-update
file: notes.md
action: create
reasoning: Good proposal
---
# Notes
\`\`\`

\`\`\`kb-update
file: claude.md
action: update
tier: structural
mode: full
reasoning: Bad mode for structural
---
replaced content
\`\`\`

\`\`\`kb-update
file: kb_digest.md
action: update
tier: status
mode: patch
reasoning: Bad mode for status
---
patched
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].file).toBe('notes.md')
    expect(rejectedProposals).toHaveLength(2)
    expect(rejectedProposals[0].file).toBe('claude.md')
    expect(rejectedProposals[1].file).toBe('kb_digest.md')
  })

  it('order stability: rejected entries match source block order', () => {
    const text = `\`\`\`kb-update
file: first.md
action: destroy
reasoning: first invalid
---
c1
\`\`\`

\`\`\`kb-update
file: second.md
action: nuke
reasoning: second invalid
---
c2
\`\`\``

    const { rejectedProposals } = parseKBUpdates(text)
    expect(rejectedProposals).toHaveLength(2)
    expect(rejectedProposals[0].file).toBe('first.md')
    expect(rejectedProposals[1].file).toBe('second.md')
  })

  it('rawExcerpt is present, ≤ 200 chars, no control chars', () => {
    const longContent = 'x'.repeat(300)
    const text = `\`\`\`kb-update
file: test.md
action: destroy
reasoning: test excerpt\x07\x08
---
${longContent}
\`\`\``

    const { rejectedProposals } = parseKBUpdates(text)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rawExcerpt).toBeDefined()
    expect(rejectedProposals[0].rawExcerpt!.length).toBeLessThanOrEqual(200)
    // Control chars should be replaced with spaces
    expect(rejectedProposals[0].rawExcerpt).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/)
  })

  it('rejects path traversal and includes reason', () => {
    const text = `\`\`\`kb-update
file: ../../../etc/passwd
action: update
reasoning: path traversal attempt
---
bad content
\`\`\``

    const { proposals, rejectedProposals } = parseKBUpdates(text)
    expect(proposals).toHaveLength(0)
    expect(rejectedProposals).toHaveLength(1)
    expect(rejectedProposals[0].rejectionReason).toBe(REJECTION_REASONS.PATH_TRAVERSAL)
  })

  it('rejected proposals have deterministic IDs', () => {
    const text = `\`\`\`kb-update
file: claude.md
action: update
tier: structural
mode: full
reasoning: test
---
content
\`\`\``

    const r1 = parseKBUpdates(text)
    const r2 = parseKBUpdates(text)
    expect(r1.rejectedProposals[0].id).toBe(r2.rejectedProposals[0].id)
    expect(r1.rejectedProposals[0].id).toMatch(/^[0-9a-f]{8}$/)
  })

  // --- parseKBUpdatesCompat backward compat ---

  it('parseKBUpdatesCompat returns only valid proposals', () => {
    const text = `\`\`\`kb-update
file: notes.md
action: create
reasoning: Good
---
# Notes
\`\`\`

\`\`\`kb-update
file: claude.md
action: update
tier: structural
mode: full
reasoning: Bad
---
content
\`\`\``

    const proposals = parseKBUpdatesCompat(text)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].file).toBe('notes.md')
  })
})
