import { describe, it, expect } from 'vitest'
import { parseBriefingAnalysis } from '../../src/briefing/output-parser.js'

describe('parseBriefingAnalysis', () => {
  it('parses all three block types', () => {
    const text = `
\`\`\`briefing-alert
domain: PT-PCA
severity: critical
text: kb_digest.md is 32 days stale, blocks PT-Refi closing
evidence: PT-PCA/kb_digest.md (status tier, 32d critical)
\`\`\`

\`\`\`briefing-action
domain: Insurance
priority: 1
deadline: 2026-02-25
text: Confirm broker submitted renewal application
\`\`\`

\`\`\`briefing-monitor
domain: PT-Lawsuit
text: Defense counsel response overdue
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0].domain).toBe('PT-PCA')
    expect(result.alerts[0].severity).toBe('critical')
    expect(result.alerts[0].text).toBe('kb_digest.md is 32 days stale, blocks PT-Refi closing')
    expect(result.alerts[0].evidence).toBe('PT-PCA/kb_digest.md (status tier, 32d critical)')

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].domain).toBe('Insurance')
    expect(result.actions[0].priority).toBe(1)
    expect(result.actions[0].deadline).toBe('2026-02-25')
    expect(result.actions[0].text).toBe('Confirm broker submitted renewal application')

    expect(result.monitors).toHaveLength(1)
    expect(result.monitors[0].domain).toBe('PT-Lawsuit')
    expect(result.monitors[0].text).toBe('Defense counsel response overdue')

    expect(result.diagnostics.skippedBlocks).toBe(0)
    expect(result.diagnostics.errors).toHaveLength(0)
  })

  it('parses multiline text field', () => {
    const text = `
\`\`\`briefing-alert
domain: Insurance
severity: warning
text: Policy renewal due in 10 days
  and broker has not confirmed submission
  check with agent before deadline
evidence: Insurance/kb_digest.md
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0].text).toBe(
      'Policy renewal due in 10 days and broker has not confirmed submission check with agent before deadline',
    )
  })

  it('parses multiline evidence field', () => {
    const text = `
\`\`\`briefing-alert
domain: PT-Refi
severity: critical
text: Refi blocked by stale PCA
evidence: PT-PCA/kb_digest.md (status tier, 32d critical)
  Dependency: PT-PCA blocks PT-Refi
  See CLAUDE.md for deadline details
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0].evidence).toContain('PT-PCA/kb_digest.md')
    expect(result.alerts[0].evidence).toContain('Dependency: PT-PCA blocks PT-Refi')
    expect(result.alerts[0].evidence).toContain('See CLAUDE.md for deadline details')
  })

  it('rejects invalid priority', () => {
    const text = `
\`\`\`briefing-action
domain: Insurance
priority: abc
text: Check renewal status
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.actions).toHaveLength(0)
    expect(result.diagnostics.skippedBlocks).toBe(1)
    expect(result.diagnostics.errors.some((e) => e.includes('priority'))).toBe(true)
  })

  it('rejects priority out of range', () => {
    const textLow = `
\`\`\`briefing-action
domain: Test
priority: 0
text: Do something
\`\`\`
`
    const textHigh = `
\`\`\`briefing-action
domain: Test
priority: 8
text: Do something else
\`\`\`
`
    expect(parseBriefingAnalysis(textLow).actions).toHaveLength(0)
    expect(parseBriefingAnalysis(textLow).diagnostics.skippedBlocks).toBe(1)
    expect(parseBriefingAnalysis(textHigh).actions).toHaveLength(0)
    expect(parseBriefingAnalysis(textHigh).diagnostics.skippedBlocks).toBe(1)
  })

  it('rejects invalid severity', () => {
    const text = `
\`\`\`briefing-alert
domain: Test
severity: high
text: Something is wrong
evidence: test file
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(0)
    expect(result.diagnostics.skippedBlocks).toBe(1)
    expect(result.diagnostics.errors.some((e) => e.includes('severity'))).toBe(true)
  })

  it('rejects alert missing evidence', () => {
    const text = `
\`\`\`briefing-alert
domain: Test
severity: critical
text: Something is wrong
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(0)
    expect(result.diagnostics.skippedBlocks).toBe(1)
    expect(result.diagnostics.errors.some((e) => e.includes('evidence'))).toBe(true)
  })

  it('counts diagnostics correctly with mixed valid and invalid', () => {
    const text = `
\`\`\`briefing-alert
domain: Valid
severity: warning
text: This one is fine
evidence: some evidence
\`\`\`

\`\`\`briefing-alert
domain: Bad1
severity: oops
text: Invalid severity
evidence: some evidence
\`\`\`

\`\`\`briefing-action
domain: Bad2
text: No priority
\`\`\`

\`\`\`briefing-monitor
domain: AlsoValid
text: Watch this
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(1)
    expect(result.actions).toHaveLength(0)
    expect(result.monitors).toHaveLength(1)
    expect(result.diagnostics.skippedBlocks).toBe(2)
    expect(result.diagnostics.errors.length).toBe(2)
  })

  it('returns empty arrays for empty input', () => {
    const result = parseBriefingAnalysis('')
    expect(result.alerts).toEqual([])
    expect(result.actions).toEqual([])
    expect(result.monitors).toEqual([])
    expect(result.diagnostics.skippedBlocks).toBe(0)
    expect(result.diagnostics.errors).toEqual([])
  })

  it('returns empty arrays for input with no blocks', () => {
    const result = parseBriefingAnalysis('Just some text without any blocks')
    expect(result.alerts).toEqual([])
    expect(result.actions).toEqual([])
    expect(result.monitors).toEqual([])
  })

  it('normalizes missing deadline to "none"', () => {
    const text = `
\`\`\`briefing-action
domain: Insurance
priority: 2
text: Follow up with broker
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].deadline).toBe('none')
  })

  it('normalizes invalid deadline format to "none" with diagnostic', () => {
    const text = `
\`\`\`briefing-action
domain: Insurance
priority: 2
deadline: next week
text: Follow up with broker
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].deadline).toBe('none')
    expect(result.diagnostics.errors.some((e) => e.includes('deadline'))).toBe(true)
  })

  it('handles non-indented continuation as part of current field', () => {
    const text = `
\`\`\`briefing-monitor
domain: PT-Lawsuit
text: Defense counsel response overdue
expected 2 weeks ago
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.monitors).toHaveLength(1)
    // Non-indented continuation still appended to current field
    expect(result.monitors[0].text).toContain('Defense counsel response overdue')
    expect(result.monitors[0].text).toContain('expected 2 weeks ago')
  })

  it('tolerates underscore separator: briefing_alert', () => {
    const text = `
\`\`\`briefing_alert
domain: Test
severity: warning
text: Test alert
evidence: test evidence
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0].domain).toBe('Test')
  })

  it('tolerates mixed case: Briefing-Action', () => {
    const text = `
\`\`\`Briefing-Action
domain: Test
priority: 3
text: Test action
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].priority).toBe(3)
  })

  it('tolerates trailing space: briefing-monitor ', () => {
    const text = `
\`\`\`briefing-monitor ${' '}
domain: Test
text: Watch this thing
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.monitors).toHaveLength(1)
    expect(result.monitors[0].domain).toBe('Test')
  })

  it('handles missing colon with diagnostic', () => {
    const text = `
\`\`\`briefing-action
domain: Insurance
priority: 2
deadline 2026-02-25
text: Follow up with broker
\`\`\`
`
    const result = parseBriefingAnalysis(text)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].deadline).toBe('2026-02-25')
    expect(result.diagnostics.errors.some((e) => e.includes('Missing colon'))).toBe(true)
  })
})
