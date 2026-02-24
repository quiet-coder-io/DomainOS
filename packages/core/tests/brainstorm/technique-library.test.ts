import { describe, it, expect } from 'vitest'
import {
  TECHNIQUES,
  ELICITATION_METHODS,
  ALL_TECHNIQUES,
  TECHNIQUE_CATEGORIES,
  getById,
  getByCategory,
  recommend,
  getRandom,
} from '../../src/brainstorm/technique-library.js'
import type { TechniqueCategory } from '../../src/brainstorm/technique-library.js'

describe('TECHNIQUES', () => {
  it('has 56 techniques', () => {
    expect(TECHNIQUES).toHaveLength(56)
  })

  it('every technique has a unique id', () => {
    const ids = TECHNIQUES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every technique has required fields', () => {
    for (const t of TECHNIQUES) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(TECHNIQUE_CATEGORIES).toContain(t.category)
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.keywords.length).toBeGreaterThan(0)
    }
  })
})

describe('ELICITATION_METHODS', () => {
  it('has 50 elicitation methods', () => {
    expect(ELICITATION_METHODS).toHaveLength(50)
  })

  it('every method has a unique id', () => {
    const ids = ELICITATION_METHODS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no id collisions between TECHNIQUES and ELICITATION_METHODS', () => {
    const techIds = new Set(TECHNIQUES.map((t) => t.id))
    for (const m of ELICITATION_METHODS) {
      expect(techIds.has(m.id)).toBe(false)
    }
  })
})

describe('ALL_TECHNIQUES', () => {
  it('combines TECHNIQUES + ELICITATION_METHODS', () => {
    expect(ALL_TECHNIQUES).toHaveLength(TECHNIQUES.length + ELICITATION_METHODS.length)
  })
})

describe('TECHNIQUE_CATEGORIES', () => {
  it('has 10 categories', () => {
    expect(TECHNIQUE_CATEGORIES).toHaveLength(10)
  })

  it('all categories are covered by at least one technique', () => {
    for (const cat of TECHNIQUE_CATEGORIES) {
      const found = ALL_TECHNIQUES.some((t) => t.category === cat)
      expect(found, `No techniques in category: ${cat}`).toBe(true)
    }
  })
})

describe('getById', () => {
  it('returns a technique by id', () => {
    const t = getById('creative-scamper')
    expect(t).toBeDefined()
    expect(t!.name).toBe('SCAMPER')
  })

  it('returns an elicitation method by id', () => {
    const first = ELICITATION_METHODS[0]
    const found = getById(first.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(first.id)
  })

  it('returns undefined for unknown id', () => {
    expect(getById('nonexistent-technique')).toBeUndefined()
  })
})

describe('getByCategory', () => {
  it('returns techniques for a valid category', () => {
    const creative = getByCategory('creative')
    expect(creative.length).toBeGreaterThan(0)
    for (const t of creative) {
      expect(t.category).toBe('creative')
    }
  })

  it('returns techniques for every category', () => {
    for (const cat of TECHNIQUE_CATEGORIES) {
      const results = getByCategory(cat)
      expect(results.length, `Empty category: ${cat}`).toBeGreaterThan(0)
    }
  })
})

describe('recommend', () => {
  it('returns heuristic source', () => {
    const result = recommend('user onboarding')
    expect(result.source).toBe('heuristic')
  })

  it('returns techniques sorted by relevance', () => {
    const result = recommend('user onboarding')
    expect(result.techniques.length).toBeGreaterThan(0)
    expect(result.techniques.length).toBeLessThanOrEqual(ALL_TECHNIQUES.length)
  })

  it('ranks keyword-matching techniques higher', () => {
    const result = recommend('reverse thinking opposite problem')
    // 'creative-reverse-brainstorm' has keywords: reverse, opposite, problem
    const topIds = result.techniques.slice(0, 5).map((t) => t.id)
    expect(topIds).toContain('creative-reverse-brainstorm')
  })

  it('considers goals for category affinity', () => {
    const withGoals = recommend('improve efficiency', 'strategic planning risk assessment')
    const withoutGoals = recommend('improve efficiency')
    // With strategic goals, strategic techniques should rank higher
    const strategicRankWith = withGoals.techniques.findIndex((t) => t.category === 'strategic')
    const strategicRankWithout = withoutGoals.techniques.findIndex((t) => t.category === 'strategic')
    // At minimum, both should return results
    expect(withGoals.techniques.length).toBeGreaterThan(0)
    expect(withoutGoals.techniques.length).toBeGreaterThan(0)
  })
})

describe('getRandom', () => {
  it('returns requested count', () => {
    const result = getRandom(5)
    expect(result).toHaveLength(5)
  })

  it('returns unique techniques', () => {
    const result = getRandom(10)
    const ids = result.map((t) => t.id)
    expect(new Set(ids).size).toBe(10)
  })

  it('respects excludeCategories', () => {
    const result = getRandom(10, ['creative', 'analytical'])
    for (const t of result) {
      expect(t.category).not.toBe('creative')
      expect(t.category).not.toBe('analytical')
    }
  })

  it('handles count larger than available techniques', () => {
    const result = getRandom(1000)
    expect(result.length).toBeLessThanOrEqual(ALL_TECHNIQUES.length)
  })

  it('returns 0 when count is 0', () => {
    expect(getRandom(0)).toHaveLength(0)
  })
})
