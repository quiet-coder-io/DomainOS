import { describe, it, expect } from 'vitest'
import { calculateStaleness, STALENESS_THRESHOLDS } from '../../src/kb/staleness.js'

const MS_PER_DAY = 86_400_000

function daysAgo(days: number): number {
  return Date.now() - days * MS_PER_DAY
}

describe('calculateStaleness', () => {
  describe('structural tier (30/90 day thresholds)', () => {
    it('is fresh at 0 days', () => {
      const result = calculateStaleness(Date.now(), undefined, 'structural')
      expect(result.level).toBe('fresh')
      expect(result.daysSinceUpdate).toBe(0)
      expect(result.basis).toBe('mtime')
    })

    it('is fresh at 29 days', () => {
      const result = calculateStaleness(daysAgo(29), undefined, 'structural')
      expect(result.level).toBe('fresh')
    })

    it('is stale at 30 days', () => {
      const result = calculateStaleness(daysAgo(30), undefined, 'structural')
      expect(result.level).toBe('stale')
      expect(result.daysSinceUpdate).toBe(30)
    })

    it('is critical at 90 days', () => {
      const result = calculateStaleness(daysAgo(90), undefined, 'structural')
      expect(result.level).toBe('critical')
    })
  })

  describe('status tier (7/21 day thresholds)', () => {
    it('is fresh at 6 days', () => {
      const result = calculateStaleness(daysAgo(6), undefined, 'status')
      expect(result.level).toBe('fresh')
    })

    it('is stale at 7 days', () => {
      const result = calculateStaleness(daysAgo(7), undefined, 'status')
      expect(result.level).toBe('stale')
    })

    it('is critical at 21 days', () => {
      const result = calculateStaleness(daysAgo(21), undefined, 'status')
      expect(result.level).toBe('critical')
    })
  })

  describe('intelligence tier (14/45 day thresholds)', () => {
    it('is fresh at 13 days', () => {
      const result = calculateStaleness(daysAgo(13), undefined, 'intelligence')
      expect(result.level).toBe('fresh')
    })

    it('is stale at 14 days', () => {
      const result = calculateStaleness(daysAgo(14), undefined, 'intelligence')
      expect(result.level).toBe('stale')
    })

    it('is critical at 45 days', () => {
      const result = calculateStaleness(daysAgo(45), undefined, 'intelligence')
      expect(result.level).toBe('critical')
    })
  })

  describe('general tier (14/45 day thresholds)', () => {
    it('same thresholds as intelligence', () => {
      expect(STALENESS_THRESHOLDS.general).toEqual(STALENESS_THRESHOLDS.intelligence)
    })
  })

  describe('semantic update fallback', () => {
    it('uses lastSemanticUpdateAt when provided', () => {
      const recentSemantic = new Date(daysAgo(2)).toISOString()
      const result = calculateStaleness(daysAgo(30), recentSemantic, 'status')
      expect(result.level).toBe('fresh') // semantic says 2 days, not 30
      expect(result.basis).toBe('semantic')
    })

    it('falls back to mtime when lastSemanticUpdateAt is undefined', () => {
      const result = calculateStaleness(daysAgo(10), undefined, 'status')
      expect(result.level).toBe('stale')
      expect(result.basis).toBe('mtime')
    })
  })
})
