import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../src/agents/prompt-builder.js'
import type { PromptContext } from '../../src/agents/prompt-builder.js'

describe('buildSystemPrompt', () => {
  const baseContext: PromptContext = {
    domain: { name: 'Real Estate', description: 'Manages property portfolios.' },
    kbContext: {
      files: [
        { path: 'properties.md', content: '# Properties\n- 123 Main St' },
        { path: 'tenants.md', content: '# Tenants\n- John Doe' },
      ],
    },
    protocols: [
      { name: 'Lease Review', content: 'Review lease terms before renewal.' },
      { name: 'Maintenance', content: 'Route all maintenance requests to vendor.' },
    ],
  }

  it('includes domain name and description', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).toContain('=== DOMAIN: Real Estate ===')
    expect(prompt).toContain('Manages property portfolios.')
  })

  it('includes KB file paths and content', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).toContain('properties.md ---')
    expect(prompt).toContain('# Properties\n- 123 Main St')
    expect(prompt).toContain('tenants.md ---')
    expect(prompt).toContain('# Tenants\n- John Doe')
  })

  it('includes protocol names and content in DOMAIN PROTOCOLS section', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).toContain('=== DOMAIN PROTOCOLS ===')
    expect(prompt).toContain('--- Lease Review ---')
    expect(prompt).toContain('Review lease terms before renewal.')
    expect(prompt).toContain('--- Maintenance ---')
    expect(prompt).toContain('Route all maintenance requests to vendor.')
  })

  it('includes KB update instructions with tier and mode fields', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).toContain('=== KB UPDATE INSTRUCTIONS ===')
    expect(prompt).toContain('```kb-update')
    expect(prompt).toContain('file: <filename>')
    expect(prompt).toContain('action: <create|update|delete>')
    expect(prompt).toContain('tier: <structural|status|intelligence|general>')
    expect(prompt).toContain('mode: <full|append|patch>')
    expect(prompt).toContain('basis: <primary|sibling|external|user>')
  })

  it('includes decision block format in instructions', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).toContain('```decision')
    expect(prompt).toContain('decision_id:')
    expect(prompt).toContain('linked_files:')
  })

  it('works with empty KB files', () => {
    const context: PromptContext = { ...baseContext, kbContext: { files: [] } }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== KNOWLEDGE BASE ===')
  })

  it('works with empty protocols', () => {
    const context: PromptContext = { ...baseContext, protocols: [] }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== DOMAIN PROTOCOLS ===')
    expect(prompt).toContain('=== KB UPDATE INSTRUCTIONS ===')
  })

  it('emits AGENT IDENTITY section when identity is set', () => {
    const context: PromptContext = {
      ...baseContext,
      domain: { ...baseContext.domain, identity: 'You are an expert real estate agent.' },
    }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== AGENT IDENTITY ===')
    expect(prompt).toContain('You are an expert real estate agent.')
    // Identity should come before domain section
    const identityIdx = prompt.indexOf('=== AGENT IDENTITY ===')
    const domainIdx = prompt.indexOf('=== DOMAIN:')
    expect(identityIdx).toBeLessThan(domainIdx)
  })

  it('omits AGENT IDENTITY section when identity is empty', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).not.toContain('=== AGENT IDENTITY ===')
  })

  it('emits CURRENT DATE as the first section when provided', () => {
    const context: PromptContext = {
      ...baseContext,
      domain: { ...baseContext.domain, identity: 'You are a test agent.' },
      currentDate: 'Wednesday, February 18, 2026 at 1:15 PM PST',
    }
    const { prompt, manifest } = buildSystemPrompt(context)
    expect(prompt).toContain('=== CURRENT DATE ===')
    expect(prompt).toContain('Wednesday, February 18, 2026 at 1:15 PM PST')
    // Current Date should come before Agent Identity
    const dateIdx = prompt.indexOf('=== CURRENT DATE ===')
    const identityIdx = prompt.indexOf('=== AGENT IDENTITY ===')
    expect(dateIdx).toBeLessThan(identityIdx)
    // Manifest should include the section
    expect(manifest.sections[0].name).toBe('Current Date')
  })

  it('omits CURRENT DATE section when not provided', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).not.toContain('=== CURRENT DATE ===')
  })

  it('emits ESCALATION TRIGGERS section when set', () => {
    const context: PromptContext = {
      ...baseContext,
      domain: { ...baseContext.domain, escalationTriggers: 'If lease amount exceeds $50k, stop.' },
    }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== ESCALATION TRIGGERS ===')
    expect(prompt).toContain('If lease amount exceeds $50k, stop.')
  })

  it('omits ESCALATION TRIGGERS section when empty', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).not.toContain('=== ESCALATION TRIGGERS ===')
  })

  it('emits SHARED PROTOCOLS section when provided', () => {
    const context: PromptContext = {
      ...baseContext,
      sharedProtocols: [{ name: 'STOP Protocol', content: 'Stop when unsure.' }],
    }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== SHARED PROTOCOLS ===')
    expect(prompt).toContain('--- STOP Protocol ---')
    expect(prompt).toContain('Stop when unsure.')
    // Shared protocols should come before domain protocols
    const sharedIdx = prompt.indexOf('=== SHARED PROTOCOLS ===')
    const domainProtoIdx = prompt.indexOf('=== DOMAIN PROTOCOLS ===')
    expect(sharedIdx).toBeLessThan(domainProtoIdx)
  })

  it('omits SHARED PROTOCOLS section when empty', () => {
    const { prompt } = buildSystemPrompt(baseContext)
    expect(prompt).not.toContain('=== SHARED PROTOCOLS ===')
  })

  it('emits SIBLING DOMAINS section with contamination guard', () => {
    const context: PromptContext = {
      ...baseContext,
      siblingContext: {
        siblings: [{ domainName: 'Accounting', digestContent: 'Financial overview...' }],
      },
    }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('=== SIBLING DOMAINS ===')
    expect(prompt).toContain('--- Accounting ---')
    expect(prompt).toContain('Financial overview...')
    expect(prompt).toContain('CROSS-DOMAIN CONTAMINATION GUARD')
  })

  it('emits tier labels in KB file headers', () => {
    const context: PromptContext = {
      ...baseContext,
      kbContext: {
        files: [
          { path: 'claude.md', content: 'config', tier: 'structural', stalenessLabel: '[FRESH]' },
          { path: 'kb_digest.md', content: 'digest', tier: 'status', stalenessLabel: '[STALE - 12 days]' },
        ],
      },
    }
    const { prompt } = buildSystemPrompt(context)
    expect(prompt).toContain('[STRUCTURAL] [FRESH] claude.md ---')
    expect(prompt).toContain('[STATUS] [STALE - 12 days] kb_digest.md ---')
  })

  it('returns a manifest with section token estimates', () => {
    const { manifest } = buildSystemPrompt(baseContext)
    expect(manifest.sections.length).toBeGreaterThan(0)
    expect(manifest.totalTokenEstimate).toBeGreaterThan(0)
    const sectionNames = manifest.sections.map((s) => s.name)
    expect(sectionNames).toContain('Domain')
    expect(sectionNames).toContain('Knowledge Base')
    expect(sectionNames).toContain('Domain Protocols')
    expect(sectionNames).toContain('KB Update Instructions')
  })

  it('returns filesIncluded in manifest', () => {
    const { manifest } = buildSystemPrompt(baseContext)
    expect(manifest.filesIncluded).toHaveLength(2)
    expect(manifest.filesIncluded[0].path).toBe('properties.md')
    expect(manifest.filesIncluded[0].tokenEstimate).toBeGreaterThan(0)
  })

  // Golden prompt snapshot — catches unintended prompt regressions
  it('golden prompt snapshot with all sections populated', () => {
    const fullContext: PromptContext = {
      domain: {
        name: 'Test Domain',
        description: 'A test domain.',
        identity: 'You are a test agent.',
        escalationTriggers: 'Stop if tests fail.',
      },
      kbContext: {
        files: [
          { path: 'claude.md', content: '# Config', tier: 'structural', stalenessLabel: '[FRESH]' },
          { path: 'kb_digest.md', content: '# Digest', tier: 'status', stalenessLabel: '[STALE - 8 days]' },
        ],
      },
      protocols: [{ name: 'Test Protocol', content: 'Test content.' }],
      sharedProtocols: [{ name: 'Shared Test', content: 'Shared content.' }],
      siblingContext: {
        siblings: [{ domainName: 'Sibling', digestContent: 'Sibling digest.' }],
      },
      sessionContext: {
        scope: 'working',
        startupReport: 'All systems operational.',
      },
      currentDate: 'Wednesday, February 18, 2026 at 1:15 PM PST',
    }

    const { prompt, manifest } = buildSystemPrompt(fullContext)

    // Verify section ordering
    const sectionOrder = [
      '=== CURRENT DATE ===',
      '=== AGENT IDENTITY ===',
      '=== DOMAIN: Test Domain ===',
      '=== KNOWLEDGE BASE ===',
      '=== SIBLING DOMAINS ===',
      '=== SHARED PROTOCOLS ===',
      '=== DOMAIN PROTOCOLS ===',
      '=== ESCALATION TRIGGERS ===',
      '=== SESSION ===',
      '=== KB UPDATE INSTRUCTIONS ===',
      '=== ADVISORY PROTOCOL ===',
    ]

    let lastIndex = -1
    for (const section of sectionOrder) {
      const idx = prompt.indexOf(section)
      expect(idx).toBeGreaterThan(lastIndex)
      lastIndex = idx
    }

    // Verify manifest completeness
    expect(manifest.sections.length).toBe(11)
    expect(manifest.filesIncluded.length).toBe(2)
    expect(manifest.totalTokenEstimate).toBeGreaterThan(0)
  })
})
