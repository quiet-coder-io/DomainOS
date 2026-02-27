import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, renderStatusCapsule } from '../../src/agents/prompt-builder.js'
import type { PromptContext } from '../../src/agents/prompt-builder.js'
import type { DomainStatusSnapshot } from '../../src/briefing/domain-status.js'
import {
  estimateTokens,
  estimateChatTokens,
  clamp,
  getPromptProfile,
  PROMPT_PROFILES,
  TOKEN_BUDGETS,
} from '../../src/agents/token-budgets.js'

// --- Shared test fixtures ---

const baseContext: PromptContext = {
  domain: {
    name: 'Test Domain',
    description: 'A test domain for real estate management.',
    identity: 'You are an expert real estate agent.',
    escalationTriggers: 'Stop if lease amount exceeds $50k.',
    tags: [
      { key: 'property', value: '123 Main St' },
      { key: 'contact', value: 'John Doe' },
    ],
  },
  kbContext: {
    files: [
      { path: 'claude.md', content: '# Config\nDomain identity and setup.\n'.repeat(20), tier: 'structural', stalenessLabel: '[FRESH]' },
      { path: 'kb_digest.md', content: '# Digest\nStatus overview.\n'.repeat(20), tier: 'status', stalenessLabel: '[FRESH]' },
      { path: 'notes.md', content: '# Notes\nGeneral notes.\n'.repeat(50), tier: 'general' },
    ],
  },
  protocols: [
    { name: 'Lease Review', content: 'Review lease terms before renewal. MUST verify tenant income. NEVER approve without credit check.' },
    { name: 'Maintenance', content: 'Route all maintenance requests to vendor. Approval required for >$500.' },
  ],
  sharedProtocols: [{ name: 'STOP Protocol', content: 'Stop when unsure.' }],
  siblingContext: {
    siblings: [{ domainName: 'Accounting', digestContent: 'Financial overview...' }],
  },
  sessionContext: { scope: 'working', startupReport: 'All systems operational.' },
  currentDate: 'Wednesday, February 27, 2026 at 11:00 AM PST',
}

function makeSnapshot(overrides?: Partial<DomainStatusSnapshot>): DomainStatusSnapshot {
  return {
    snapshotVersion: 1,
    domainId: 'test-id',
    domainName: 'Test Domain',
    computedAt: '2026-02-27T19:00:00Z',
    sinceWindow: { kind: 'none', since: null, label: 'No prior session' },
    severityScore: 42,
    status: 'active',
    kbStalenessHeadline: 'All files fresh',
    topActions: [
      { text: 'Review lease for 123 Main St', source: 'deadline', priorityScore: 80, rationale: 'Due tomorrow' },
      { text: 'Follow up with tenant', source: 'gap_flag', priorityScore: 60, rationale: 'Open gap' },
      { text: 'Update insurance docs', source: 'kb_staleness', priorityScore: 40, rationale: 'Stale 14d' },
      { text: 'Check property tax assessment', source: 'deadline', priorityScore: 35, rationale: 'Due next week' },
    ],
    recentAuditEvents: [],
    recentDecisions: [],
    overdueDeadlines: [
      { text: 'Submit insurance renewal', dueDate: '2026-02-20', priority: 1, daysOverdue: 7 },
      { text: 'File property tax protest', dueDate: '2026-02-15', priority: 2, daysOverdue: 12 },
      { text: 'Return security deposit', dueDate: '2026-02-22', priority: 3, daysOverdue: 5 },
      { text: 'Pay water bill', dueDate: '2026-02-24', priority: 4, daysOverdue: 3 },
      { text: 'Schedule HVAC inspection', dueDate: '2026-02-25', priority: 3, daysOverdue: 2 },
      { text: 'Send lease violation notice', dueDate: '2026-02-26', priority: 2, daysOverdue: 1 },
      { text: 'Extra overdue item 7', dueDate: '2026-02-10', priority: 1, daysOverdue: 17 },
    ],
    upcomingDeadlines: [],
    openGapFlags: [
      { category: 'legal', description: 'Missing tenant lease agreement', createdAt: '2026-02-20T00:00:00Z' },
      { category: 'financial', description: 'Rent collection discrepancy $2500', createdAt: '2026-02-21T00:00:00Z' },
      { category: 'compliance', description: 'Fire extinguisher inspection overdue', createdAt: '2026-02-22T00:00:00Z' },
      { category: 'documentation', description: 'Missing HOA compliance letter', createdAt: '2026-02-23T00:00:00Z' },
      { category: 'security', description: 'Broken exterior lock unit 4B', createdAt: '2026-02-24T00:00:00Z' },
      { category: 'process', description: 'Vendor payment workflow incomplete', createdAt: '2026-02-25T00:00:00Z' },
      { category: 'blocker', description: 'Lender response pending for refi', createdAt: '2026-02-26T00:00:00Z' },
    ],
    recentlyResolvedGapFlags: [],
    recentArtifacts: [],
    searchHints: { keywords: ['lease', 'insurance'], gmailQueries: ['from:tenant'], gtasksQueries: ['lease'] },
    ...overrides,
  }
}

// --- Tests ---

describe('estimateChatTokens', () => {
  it('includes role overhead per message', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'a'.repeat(100),
    }))
    const tokens = estimateChatTokens(messages)
    // Each message: ceil(100/4)=25 content tokens + 4 overhead = 29
    // 10 messages * 29 = 290
    expect(tokens).toBe(290)
  })

  it('returns 0 for empty messages', () => {
    expect(estimateChatTokens([])).toBe(0)
  })
})

describe('clamp', () => {
  it('clamps value below min', () => {
    expect(clamp(100, 500, 3000)).toBe(500)
  })

  it('clamps value above max', () => {
    expect(clamp(5000, 500, 3000)).toBe(3000)
  })

  it('returns value in range', () => {
    expect(clamp(1500, 500, 3000)).toBe(1500)
  })
})

describe('getPromptProfile', () => {
  it('returns cloud_full profile', () => {
    const p = getPromptProfile('cloud_full')
    expect(p.name).toBe('cloud_full')
    expect(p.modelContextLimit).toBe(128_000)
    expect(p.kbStrategy).toBe('full')
  })

  it('returns ollama_fast profile', () => {
    const p = getPromptProfile('ollama_fast')
    expect(p.name).toBe('ollama_fast')
    expect(p.maxSystemBudget).toBe(3_000)
    expect(p.kbStrategy).toBe('digest_only')
    expect(p.sections.siblings).toBe(false)
    expect(p.sections.advisory).toBe('micro')
  })

  it('returns ollama_balanced profile', () => {
    const p = getPromptProfile('ollama_balanced')
    expect(p.name).toBe('ollama_balanced')
    expect(p.maxSystemBudget).toBe(6_000)
    expect(p.kbStrategy).toBe('digest_plus_structural')
    expect(p.sections.domainProtocols).toBe('micro')
  })
})

describe('buildSystemPrompt with profiles', () => {
  describe('cloud_full backward compatibility', () => {
    it('produces identical output with no profile param', () => {
      const withoutProfile = buildSystemPrompt(baseContext)
      const withProfile = buildSystemPrompt(baseContext, PROMPT_PROFILES.cloud_full)

      expect(withProfile.prompt).toBe(withoutProfile.prompt)
      expect(withProfile.manifest.totalTokenEstimate).toBe(withoutProfile.manifest.totalTokenEstimate)
    })

    it('includes all sections for cloud_full', () => {
      const { manifest } = buildSystemPrompt(baseContext, PROMPT_PROFILES.cloud_full)
      const names = manifest.sections.map(s => s.name)
      expect(names).toContain('Agent Identity')
      expect(names).toContain('Domain')
      expect(names).toContain('Knowledge Base')
      expect(names).toContain('Domain Associations')
      expect(names).toContain('Sibling Domains')
      expect(names).toContain('Shared Protocols')
      expect(names).toContain('Domain Protocols')
      expect(names).toContain('Escalation Triggers')
      expect(names).toContain('Session')
      expect(names).toContain('KB Update Instructions')
      expect(names).toContain('Advisory Mini-Protocol')
    })

    it('has no excluded sections for cloud_full', () => {
      const { manifest } = buildSystemPrompt(baseContext, PROMPT_PROFILES.cloud_full)
      expect(manifest.excludedSections.length).toBe(0)
    })

    it('manifest includes profileName and systemBudget', () => {
      const { manifest } = buildSystemPrompt(baseContext, PROMPT_PROFILES.cloud_full)
      expect(manifest.profileName).toBe('cloud_full')
      expect(manifest.systemBudget).toBe(TOKEN_BUDGETS.total)
    })
  })

  describe('ollama_fast budget enforcement', () => {
    it('output token estimate stays within 3000 budget', () => {
      const profile = PROMPT_PROFILES.ollama_fast
      const { manifest } = buildSystemPrompt(baseContext, profile, 3000)

      // With safety factor, should stay within budget
      expect(manifest.totalTokenEstimateWithSafety).toBeLessThanOrEqual(3000)
    })

    it('required-core sections are always present', () => {
      const profile = PROMPT_PROFILES.ollama_fast
      const { prompt, manifest } = buildSystemPrompt(baseContext, profile, 3000)

      // Identity + Domain are required-core
      expect(prompt).toContain('=== AGENT IDENTITY ===')
      expect(prompt).toContain('=== DOMAIN:')
      expect(prompt).toContain('=== KNOWLEDGE BASE ===')
      expect(prompt).toContain('=== ESCALATION TRIGGERS ===')

      const names = manifest.sections.map(s => s.name)
      expect(names).toContain('Agent Identity')
      expect(names).toContain('Domain')
      expect(names).toContain('Knowledge Base')
      expect(names).toContain('Escalation Triggers')
    })

    it('excludes siblings, shared protocols, skill, session, kbInstructions, brainstorm', () => {
      const profile = PROMPT_PROFILES.ollama_fast
      const { manifest, prompt } = buildSystemPrompt(baseContext, profile, 3000)

      const excluded = manifest.excludedSections.map(s => s.name)
      expect(excluded).toContain('Sibling Domains')
      expect(excluded).toContain('Shared Protocols')
      expect(excluded).toContain('Session')
      expect(excluded).toContain('KB Update Instructions')

      expect(prompt).not.toContain('=== SIBLING DOMAINS ===')
      expect(prompt).not.toContain('=== SHARED PROTOCOLS ===')
      expect(prompt).not.toContain('=== SESSION ===')
      expect(prompt).not.toContain('=== KB UPDATE INSTRUCTIONS ===')
    })

    it('uses micro advisory protocol', () => {
      const profile = PROMPT_PROFILES.ollama_fast
      const { prompt } = buildSystemPrompt(baseContext, profile, 3000)
      expect(prompt).toContain('=== ADVISORY GUARDRAILS ===')
      expect(prompt).not.toContain('=== ADVISORY PROTOCOL ===')
    })

    it('respects tagsCap of 5', () => {
      const manyTags = Array.from({ length: 20 }, (_, i) => ({ key: `tag${i}`, value: `val${i}` }))
      const ctx: PromptContext = {
        ...baseContext,
        domain: { ...baseContext.domain, tags: manyTags },
      }
      const profile = PROMPT_PROFILES.ollama_fast
      const { prompt } = buildSystemPrompt(ctx, profile, 3000)
      // Should show at most 5 tag lines + 1 omitted line
      expect(prompt).toContain('more tags omitted')
      // Count actual tag value lines (Tag0: val0, etc.)
      const tagLines = prompt.split('\n').filter(l => /^Tag\d+:/.test(l))
      expect(tagLines.length).toBeLessThanOrEqual(5)
    })
  })

  describe('ollama_balanced', () => {
    it('uses micro domain protocols', () => {
      const profile = PROMPT_PROFILES.ollama_balanced
      const { prompt } = buildSystemPrompt(baseContext, profile, 6000)
      expect(prompt).toContain('=== DOMAIN PROTOCOLS (key rules) ===')
      expect(prompt).toContain('MUST')
    })

    it('output stays within 6000 budget', () => {
      const profile = PROMPT_PROFILES.ollama_balanced
      const { manifest } = buildSystemPrompt(baseContext, profile, 6000)
      expect(manifest.totalTokenEstimateWithSafety).toBeLessThanOrEqual(6000)
    })
  })

  describe('budget pressure from large context', () => {
    it('truncates required-core when budget is very tight', () => {
      const profile = PROMPT_PROFILES.ollama_fast
      // Very tight budget — 500 tokens
      const { prompt, manifest } = buildSystemPrompt(baseContext, profile, 500)

      // Should still have required-core, but truncated
      expect(prompt).toContain('=== AGENT IDENTITY ===')
      expect(prompt).toContain('=== DOMAIN:')
      // Verify it's actually bounded
      expect(manifest.totalTokenEstimate).toBeLessThan(700) // some overshoot from required-core is ok
    })
  })
})

describe('history pressure on budget', () => {
  const profile = PROMPT_PROFILES.ollama_fast

  it('systemBudget = maxSystemBudget when history is small', () => {
    const historyTokens = estimateChatTokens([{ role: 'user', content: 'hello' }])
    const rawBudget = Math.floor(
      (profile.modelContextLimit - historyTokens - profile.outputReserve) / profile.safetyFactor,
    )
    const systemBudget = clamp(rawBudget, profile.minSystemBudget, profile.maxSystemBudget)
    expect(systemBudget).toBe(profile.maxSystemBudget) // 3000
  })

  it('systemBudget decreases when history is large', () => {
    // 30K tokens of history
    const messages = Array.from({ length: 100 }, () => ({
      role: 'user',
      content: 'x'.repeat(1200), // ~300 tokens each, 100 msgs = 30400 tokens with overhead
    }))
    const historyTokens = estimateChatTokens(messages)
    expect(historyTokens).toBeGreaterThan(25000)

    const rawBudget = Math.floor(
      (profile.modelContextLimit - historyTokens - profile.outputReserve) / profile.safetyFactor,
    )
    const systemBudget = clamp(rawBudget, profile.minSystemBudget, profile.maxSystemBudget)
    // With 30K+ history against 32K context, budget should be well below max
    expect(systemBudget).toBeLessThan(profile.maxSystemBudget)
  })

  it('floors at minSystemBudget when history fills context', () => {
    // Nearly fill the context window
    const messages = Array.from({ length: 120 }, () => ({
      role: 'user',
      content: 'x'.repeat(1100),
    }))
    const historyTokens = estimateChatTokens(messages)
    const rawBudget = Math.floor(
      (profile.modelContextLimit - historyTokens - profile.outputReserve) / profile.safetyFactor,
    )
    const systemBudget = clamp(rawBudget, profile.minSystemBudget, profile.maxSystemBudget)
    expect(systemBudget).toBe(profile.minSystemBudget) // 500
  })
})

describe('renderStatusCapsule', () => {
  it('renders compact format with all sections', () => {
    const snapshot = makeSnapshot()
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 5, gapsMax: 5, actionsMax: 3 })

    expect(capsule).toContain('=== STATUS CAPSULE ===')
    expect(capsule).toContain('Health: Severity 42')
    expect(capsule).toContain('OVERDUE:')
    expect(capsule).toContain('GAPS:')
    expect(capsule).toContain('PRIORITY ACTIONS:')
  })

  it('respects overdueMax cap', () => {
    const snapshot = makeSnapshot()
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 3, gapsMax: 10, actionsMax: 10 })

    const overdueLines = capsule.split('\n').filter(l => l.startsWith('•') && capsule.indexOf(l) < capsule.indexOf('GAPS:'))
    expect(overdueLines.length).toBeLessThanOrEqual(3)
    expect(capsule).toContain('+4 more')
  })

  it('respects gapsMax cap', () => {
    const snapshot = makeSnapshot()
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 10, gapsMax: 3, actionsMax: 10 })

    expect(capsule).toContain('+4 more')
  })

  it('respects actionsMax cap', () => {
    const snapshot = makeSnapshot()
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 10, gapsMax: 10, actionsMax: 2 })

    expect(capsule).toContain('+2 more')
  })

  it('truncates individual lines to 120 chars', () => {
    const longText = 'A'.repeat(200)
    const snapshot = makeSnapshot({
      overdueDeadlines: [{ text: longText, dueDate: '2026-02-20', priority: 1, daysOverdue: 7 }],
    })
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 5, gapsMax: 5, actionsMax: 3 })

    const lines = capsule.split('\n')
    for (const line of lines) {
      if (line.startsWith('•')) {
        expect(line.length).toBeLessThanOrEqual(120)
      }
    }
  })

  it('omits empty sections', () => {
    const snapshot = makeSnapshot({
      overdueDeadlines: [],
      openGapFlags: [],
      topActions: [],
    })
    const capsule = renderStatusCapsule(snapshot, { overdueMax: 5, gapsMax: 5, actionsMax: 3 })

    expect(capsule).not.toContain('OVERDUE:')
    expect(capsule).not.toContain('GAPS:')
    expect(capsule).not.toContain('PRIORITY ACTIONS:')
    expect(capsule).toContain('=== STATUS CAPSULE ===')
    expect(capsule).toContain('Health: Severity')
  })
})

describe('capsule integration with ollama_fast profile', () => {
  it('uses capsule format instead of full briefing', () => {
    const snapshot = makeSnapshot()
    const profile = PROMPT_PROFILES.ollama_fast
    const ctx: PromptContext = {
      ...baseContext,
      statusBriefing: snapshot,
    }
    const { prompt } = buildSystemPrompt(ctx, profile, 3000)

    expect(prompt).toContain('=== STATUS CAPSULE ===')
    expect(prompt).not.toContain('=== DOMAIN STATUS BRIEFING ===')
    expect(prompt).not.toContain('=== BRIEFING RESPONSE FORMAT ===')
  })
})

describe('micro domain protocols', () => {
  it('extracts MUST/NEVER high-signal lines', () => {
    const profile = PROMPT_PROFILES.ollama_balanced
    const { prompt } = buildSystemPrompt(baseContext, profile, 6000)

    expect(prompt).toContain('MUST verify tenant income')
    expect(prompt).toContain('NEVER approve without credit check')
    expect(prompt).toContain('Approval required')
  })

  it('shows omitted count when protocols have many lines', () => {
    const manyLineProtocol: PromptContext = {
      ...baseContext,
      protocols: [{
        name: 'Big Protocol',
        content: 'MUST verify tenant income.\nCheck credit report.\nReview references.\nValidate employment.\nConfirm deposit.\nVerify identity.\nNEVER skip background check.\nDocument everything.\nFile in system.\nNotify manager.\nUpdate log.\nArchive copies.',
      }],
    }
    const profile = PROMPT_PROFILES.ollama_balanced
    const { prompt } = buildSystemPrompt(manyLineProtocol, profile, 6000)
    expect(prompt).toContain('protocol rules omitted for local model budget')
  })

  it('falls back to first 8 lines when no high-signal patterns', () => {
    const ctx: PromptContext = {
      ...baseContext,
      protocols: [{ name: 'Simple', content: 'Line 1.\nLine 2.\nLine 3.\nLine 4.\nLine 5.\nLine 6.\nLine 7.\nLine 8.\nLine 9.\nLine 10.' }],
    }
    const profile = PROMPT_PROFILES.ollama_balanced
    const { prompt } = buildSystemPrompt(ctx, profile, 6000)
    expect(prompt).toContain('=== DOMAIN PROTOCOLS (key rules) ===')
    expect(prompt).toContain('Line 1.')
    expect(prompt).toContain('Line 8.')
  })
})
