import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../src/agents/prompt-builder.js'

describe('buildSystemPrompt', () => {
  const domain = { name: 'Real Estate', description: 'Manages property portfolios.' }

  const kbContext = {
    files: [
      { path: 'properties.md', content: '# Properties\n- 123 Main St' },
      { path: 'tenants.md', content: '# Tenants\n- John Doe' },
    ],
  }

  const protocols = [
    { name: 'Lease Review', content: 'Review lease terms before renewal.' },
    { name: 'Maintenance', content: 'Route all maintenance requests to vendor.' },
  ]

  it('includes domain name and description', () => {
    const prompt = buildSystemPrompt(domain, kbContext, protocols)
    expect(prompt).toContain('=== DOMAIN: Real Estate ===')
    expect(prompt).toContain('Manages property portfolios.')
  })

  it('includes KB file paths and content', () => {
    const prompt = buildSystemPrompt(domain, kbContext, protocols)
    expect(prompt).toContain('--- FILE: properties.md ---')
    expect(prompt).toContain('# Properties\n- 123 Main St')
    expect(prompt).toContain('--- FILE: tenants.md ---')
    expect(prompt).toContain('# Tenants\n- John Doe')
  })

  it('includes protocol names and content', () => {
    const prompt = buildSystemPrompt(domain, kbContext, protocols)
    expect(prompt).toContain('--- Lease Review ---')
    expect(prompt).toContain('Review lease terms before renewal.')
    expect(prompt).toContain('--- Maintenance ---')
    expect(prompt).toContain('Route all maintenance requests to vendor.')
  })

  it('includes KB update instructions block', () => {
    const prompt = buildSystemPrompt(domain, kbContext, protocols)
    expect(prompt).toContain('=== KB UPDATE INSTRUCTIONS ===')
    expect(prompt).toContain('```kb-update')
    expect(prompt).toContain('file: <filename>')
    expect(prompt).toContain('action: <create|update|delete>')
    expect(prompt).toContain('reasoning: <why this change is needed>')
  })

  it('works with empty KB files', () => {
    const prompt = buildSystemPrompt(domain, { files: [] }, protocols)
    expect(prompt).toContain('=== KNOWLEDGE BASE ===')
    expect(prompt).not.toContain('--- FILE:')
  })

  it('works with empty protocols', () => {
    const prompt = buildSystemPrompt(domain, kbContext, [])
    expect(prompt).toContain('=== PROTOCOLS ===')
    expect(prompt).toContain('=== KB UPDATE INSTRUCTIONS ===')
  })
})
