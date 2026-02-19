import { describe, it, expect } from 'vitest'
import {
  buildBriefingPrompt,
  projectPortfolioHealthForLLM,
  redactForLLM,
} from '../../src/briefing/prompt-builder.js'
import type { PortfolioHealth, DomainHealth, CrossDomainAlert } from '../../src/briefing/portfolio-health.js'
import type { BriefingPromptContext } from '../../src/briefing/prompt-builder.js'

// ── Helpers ──

function emptyTierRecord(): Record<string, number> {
  return { structural: 0, status: 0, intelligence: 0, general: 0 }
}

function makeDomainHealth(overrides: Partial<DomainHealth> = {}): DomainHealth {
  return {
    domainId: overrides.domainId ?? 'test-id',
    domainName: overrides.domainName ?? 'Test Domain',
    status: overrides.status ?? 'active',
    fileCountTotal: overrides.fileCountTotal ?? 5,
    fileCountStatChecked: overrides.fileCountStatChecked ?? 3,
    staleSummary: overrides.staleSummary ?? {
      freshByTier: emptyTierRecord(),
      staleByTier: emptyTierRecord(),
      criticalByTier: emptyTierRecord(),
      fresh: 3,
      stale: 0,
      critical: 0,
    },
    openGapFlags: overrides.openGapFlags ?? 0,
    severityScore: overrides.severityScore ?? 0,
    lastTouchedAt: overrides.lastTouchedAt ?? '2026-02-19T12:00:00.000Z',
    outgoingDeps: overrides.outgoingDeps ?? [],
    incomingDeps: overrides.incomingDeps ?? [],
  }
}

function makeHealth(domains: DomainHealth[], alerts: CrossDomainAlert[] = []): PortfolioHealth {
  return {
    domains,
    alerts,
    computedAt: '2026-02-19T14:07:00.000Z',
    snapshotHash: 'abc123',
  }
}

function makeContext(overrides: Partial<BriefingPromptContext> = {}): BriefingPromptContext {
  const d1 = makeDomainHealth({ domainId: 'dom-a', domainName: 'Alpha' })
  const d2 = makeDomainHealth({ domainId: 'dom-b', domainName: 'Beta' })
  return {
    health: overrides.health ?? makeHealth([d1, d2]),
    digests: overrides.digests ?? [
      { domainId: 'dom-a', domainName: 'Alpha', content: 'Alpha digest content here.' },
      { domainId: 'dom-b', domainName: 'Beta', content: 'Beta digest content.' },
    ],
    currentDate: overrides.currentDate ?? 'Thursday, February 19, 2026 2:07 PM PST',
  }
}

// ── Tests ──

describe('projectPortfolioHealthForLLM', () => {
  it('includes ground truth fields and excludes internal fields', () => {
    const d1 = makeDomainHealth({
      domainId: 'dom-a',
      domainName: 'Alpha',
      staleSummary: {
        freshByTier: { structural: 1, status: 0, intelligence: 0, general: 0 },
        staleByTier: emptyTierRecord(),
        criticalByTier: { structural: 0, status: 1, intelligence: 0, general: 0 },
        fresh: 1,
        stale: 0,
        critical: 1,
        worstFile: { path: 'kb_digest.md', tier: 'status', daysSinceUpdate: 32 },
      },
    })

    const health = makeHealth([d1])
    const projected = projectPortfolioHealthForLLM(health)

    expect(projected.domains).toHaveLength(1)
    const pd = projected.domains[0]
    expect(pd.domainId).toBe('dom-a')
    expect(pd.domainName).toBe('Alpha')
    expect(pd.staleSummary.fresh).toBe(1)
    expect(pd.staleSummary.critical).toBe(1)
    expect(pd.staleSummary.criticalByTier).toEqual({ structural: 0, status: 1, intelligence: 0, general: 0 })

    // Excluded fields should not be present
    expect((pd.staleSummary as Record<string, unknown>).freshByTier).toBeUndefined()
    expect((pd.staleSummary as Record<string, unknown>).staleByTier).toBeUndefined()
    expect((pd.staleSummary as Record<string, unknown>).worstFile).toBeUndefined()
    expect((pd as Record<string, unknown>).fileCountTotal).toBeUndefined()
    expect((pd as Record<string, unknown>).fileCountStatChecked).toBeUndefined()
  })

  it('caps description at 80 chars', () => {
    const longDesc = 'A'.repeat(120)
    const d1 = makeDomainHealth({
      domainId: 'dom-a',
      outgoingDeps: [{
        targetDomainId: 'dom-b',
        targetDomainName: 'Beta',
        dependencyType: 'blocks',
        description: longDesc,
      }],
    })
    const projected = projectPortfolioHealthForLLM(makeHealth([d1]))
    expect(projected.domains[0].outgoingDeps[0].description.length).toBe(80)
  })
})

describe('buildBriefingPrompt', () => {
  it('includes ground truth JSON section', () => {
    const prompt = buildBriefingPrompt(makeContext())
    expect(prompt).toContain('=== GROUND TRUTH JSON (ProjectedHealth v1) ===')
    expect(prompt).toContain('"domainId"')
    expect(prompt).toContain('"dom-a"')
    expect(prompt).toContain('"dom-b"')
  })

  it('includes relationship table', () => {
    const d1 = makeDomainHealth({
      domainId: 'dom-a',
      domainName: 'Alpha',
      outgoingDeps: [{
        targetDomainId: 'dom-b',
        targetDomainName: 'Beta',
        dependencyType: 'blocks',
        description: 'PCA for lender closing',
      }],
    })
    const d2 = makeDomainHealth({ domainId: 'dom-b', domainName: 'Beta' })

    const ctx = makeContext({ health: makeHealth([d1, d2]) })
    const prompt = buildBriefingPrompt(ctx)
    expect(prompt).toContain('=== RELATIONSHIPS (authoritative) ===')
    expect(prompt).toContain('Alpha')
    expect(prompt).toContain('Beta')
    expect(prompt).toContain('blocks')
  })

  it('shows (none) for relationships when no deps exist', () => {
    const prompt = buildBriefingPrompt(makeContext())
    expect(prompt).toContain('=== RELATIONSHIPS (authoritative) ===\n(none)')
  })

  it('passes through missing digest placeholder', () => {
    const ctx = makeContext({
      digests: [
        { domainId: 'dom-a', domainName: 'Alpha', content: '(kb_digest.md missing)' },
        { domainId: 'dom-b', domainName: 'Beta', content: 'Beta content' },
      ],
    })
    const prompt = buildBriefingPrompt(ctx)
    expect(prompt).toContain('(kb_digest.md missing)')
    expect(prompt).toContain('Beta content')
  })

  it('does not let one huge digest crowd all others', () => {
    // Create a scenario with one very large digest and one small one
    const hugeContent = 'X'.repeat(200_000) // way over budget
    const smallContent = 'Small digest.'

    const d1 = makeDomainHealth({ domainId: 'dom-a', domainName: 'Alpha' })
    const d2 = makeDomainHealth({ domainId: 'dom-b', domainName: 'Beta' })

    const ctx = makeContext({
      health: makeHealth([d1, d2]),
      digests: [
        { domainId: 'dom-a', domainName: 'Alpha', content: hugeContent },
        { domainId: 'dom-b', domainName: 'Beta', content: smallContent },
      ],
    })
    const prompt = buildBriefingPrompt(ctx)

    // Small digest should still be present (at least MIN_CHARS_PER_DOMAIN = 500 chars,
    // but since it's only 13 chars, it should be fully preserved since floor > content)
    expect(prompt).toContain('Small digest.')
    // Huge digest should be truncated
    expect(prompt.length).toBeLessThan(hugeContent.length)
  })

  it('includes all constraint rules', () => {
    const prompt = buildBriefingPrompt(makeContext())
    expect(prompt).toContain('Do not invent relationships')
    expect(prompt).toContain('Do not dismiss or downgrade computed alerts')
    expect(prompt).toContain('Do not claim a domain is healthy')
    expect(prompt).toContain('Computed DomainStatus and severityScore are ground truth')
    expect(prompt).toContain('You may add context, suggest actions')
    expect(prompt).toContain('domain:')
  })

  it('includes output format with all three fence examples', () => {
    const prompt = buildBriefingPrompt(makeContext())
    expect(prompt).toContain('briefing-alert')
    expect(prompt).toContain('briefing-action')
    expect(prompt).toContain('briefing-monitor')
    expect(prompt).toContain('=== OUTPUT FORMAT ===')
  })

  it('produces deterministic output regardless of digest input order', () => {
    const d1 = makeDomainHealth({ domainId: 'dom-a', domainName: 'Alpha' })
    const d2 = makeDomainHealth({ domainId: 'dom-b', domainName: 'Beta' })
    const health = makeHealth([d1, d2])

    const ctx1: BriefingPromptContext = {
      health,
      digests: [
        { domainId: 'dom-a', domainName: 'Alpha', content: 'Alpha content' },
        { domainId: 'dom-b', domainName: 'Beta', content: 'Beta content' },
      ],
      currentDate: 'Thursday, February 19, 2026 2:07 PM PST',
    }

    const ctx2: BriefingPromptContext = {
      health,
      digests: [
        { domainId: 'dom-b', domainName: 'Beta', content: 'Beta content' },
        { domainId: 'dom-a', domainName: 'Alpha', content: 'Alpha content' },
      ],
      currentDate: 'Thursday, February 19, 2026 2:07 PM PST',
    }

    const prompt1 = buildBriefingPrompt(ctx1)
    const prompt2 = buildBriefingPrompt(ctx2)
    expect(prompt1).toBe(prompt2)
  })
})

describe('redactForLLM', () => {
  it('is a passthrough no-op', () => {
    const input = 'Some sensitive text with SSN 123-45-6789'
    expect(redactForLLM(input)).toBe(input)
  })
})
