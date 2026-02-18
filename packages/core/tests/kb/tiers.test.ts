import { describe, it, expect } from 'vitest'
import { classifyTier, TIER_PRIORITY } from '../../src/kb/tiers.js'

describe('classifyTier', () => {
  it('classifies claude.md as structural', () => {
    expect(classifyTier('claude.md')).toBe('structural')
  })

  it('classifies CLAUDE.md (uppercase) as structural', () => {
    expect(classifyTier('CLAUDE.md')).toBe('structural')
  })

  it('classifies nested claude.md as structural', () => {
    expect(classifyTier('sub/claude.md')).toBe('structural')
  })

  it('classifies kb_digest.md as status', () => {
    expect(classifyTier('kb_digest.md')).toBe('status')
  })

  it('classifies KB_DIGEST.md (uppercase) as status', () => {
    expect(classifyTier('KB_DIGEST.md')).toBe('status')
  })

  it('classifies kb_intel.md as intelligence', () => {
    expect(classifyTier('kb_intel.md')).toBe('intelligence')
  })

  it('classifies unknown files as general', () => {
    expect(classifyTier('properties.md')).toBe('general')
    expect(classifyTier('tenants.md')).toBe('general')
    expect(classifyTier('notes/meeting.md')).toBe('general')
  })
})

describe('TIER_PRIORITY', () => {
  it('structural has highest priority (lowest number)', () => {
    expect(TIER_PRIORITY.structural).toBe(0)
  })

  it('status comes after structural', () => {
    expect(TIER_PRIORITY.status).toBe(1)
  })

  it('intelligence comes after status', () => {
    expect(TIER_PRIORITY.intelligence).toBe(2)
  })

  it('general has lowest priority', () => {
    expect(TIER_PRIORITY.general).toBe(3)
  })

  it('priority ordering is deterministic', () => {
    const tiers = Object.entries(TIER_PRIORITY)
      .sort(([, a], [, b]) => a - b)
      .map(([name]) => name)
    expect(tiers).toEqual(['structural', 'status', 'intelligence', 'general'])
  })
})
