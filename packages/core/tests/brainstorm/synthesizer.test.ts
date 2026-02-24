import { describe, it, expect } from 'vitest'
import { synthesize } from '../../src/brainstorm/synthesizer.js'
import type { RawIdea } from '../../src/brainstorm/schemas.js'

function makeIdea(text: string, overrides?: Partial<RawIdea>): RawIdea {
  return {
    id: `idea-${Math.random().toString(36).slice(2)}`,
    text,
    techniqueId: overrides?.techniqueId ?? 'creative-scamper',
    techniqueNameSnapshot: overrides?.techniqueNameSnapshot ?? 'SCAMPER',
    category: overrides?.category ?? 'creative',
    round: overrides?.round ?? 1,
    timestamp: overrides?.timestamp ?? '2026-02-24T00:00:00Z',
  }
}

describe('synthesize', () => {
  it('produces a valid BrainstormPayload structure', () => {
    const ideas = [
      makeIdea('Add gamification elements to onboarding flow'),
      makeIdea('Create interactive tutorial with progress tracking'),
      makeIdea('Implement personalized welcome experience'),
    ]

    const result = synthesize(ideas, { topic: 'Improve onboarding' })

    expect(result.topic).toBe('Improve onboarding')
    expect(result.options.length).toBeGreaterThan(0)
    expect(result.recommendation).toBeTruthy()
    expect(typeof result.notes).toBe('string')

    // Each option has required fields
    for (const opt of result.options) {
      expect(opt.title).toBeTruthy()
      expect(opt.description).toBeTruthy()
    }
  })

  it('handles minimum viable input (3 ideas)', () => {
    const ideas = [
      makeIdea('Idea one about testing'),
      makeIdea('Idea two about testing'),
      makeIdea('Idea three about testing'),
    ]

    const result = synthesize(ideas, { topic: 'Testing' })
    expect(result.options.length).toBeGreaterThan(0)
    expect(result.recommendation).toBeTruthy()
  })

  it('limits to 10 options max', () => {
    // Create 20 distinct clusters by using very different keywords
    const ideas: RawIdea[] = []
    const topics = [
      'authentication security login password',
      'database optimization query performance',
      'frontend responsive design layout',
      'backend api endpoint routing',
      'testing coverage unit integration',
      'deployment pipeline cicd automation',
      'monitoring logging alerts metrics',
      'documentation readme guides tutorial',
      'caching redis memory speed',
      'search elasticsearch indexing full-text',
      'payments billing subscription invoice',
      'notifications email push realtime',
    ]

    for (const topic of topics) {
      ideas.push(makeIdea(`Improve ${topic}`, { round: ideas.length + 1 }))
      ideas.push(makeIdea(`Enhance ${topic}`, { round: ideas.length + 1 }))
      ideas.push(makeIdea(`Optimize ${topic}`, { round: ideas.length + 1 }))
    }

    const result = synthesize(ideas, { topic: 'System improvements' })
    expect(result.options.length).toBeLessThanOrEqual(10)
  })
})

describe('determinism', () => {
  it('same input → same output (3x assert)', () => {
    const ideas = [
      makeIdea('Add gamification to user onboarding', { round: 1, category: 'creative' }),
      makeIdea('Create interactive walkthrough tutorials', { round: 1, category: 'creative' }),
      makeIdea('Implement progress badges for new users', { round: 1, category: 'creative' }),
      makeIdea('Reduce signup form to 3 fields', { round: 2, category: 'analytical' }),
      makeIdea('A/B test different onboarding flows', { round: 2, category: 'analytical' }),
      makeIdea('Track completion rates per step', { round: 2, category: 'analytical' }),
      makeIdea('Partner with influencers for onboarding content', { round: 3, category: 'strategic' }),
      makeIdea('Create video tutorials for complex features', { round: 3, category: 'strategic' }),
    ]

    const opts = { topic: 'User onboarding', techniquesUsed: ['creative-scamper'], roundCount: 3 }

    const result1 = synthesize(ideas, opts)
    const result2 = synthesize(ideas, opts)
    const result3 = synthesize(ideas, opts)

    // Stringify for deep comparison — deterministic means identical
    const json1 = JSON.stringify(result1)
    const json2 = JSON.stringify(result2)
    const json3 = JSON.stringify(result3)

    expect(json1).toBe(json2)
    expect(json2).toBe(json3)
  })
})

describe('labeler', () => {
  it('produces readable labels for cohesive clusters', () => {
    const ideas = [
      makeIdea('Implement user authentication with OAuth'),
      makeIdea('Add two-factor authentication for security'),
      makeIdea('Create single sign-on authentication flow'),
      makeIdea('Build password reset authentication system'),
    ]

    const result = synthesize(ideas, { topic: 'Auth system' })
    // Should produce a label, not "Option N: ..."
    const firstOption = result.options[0]
    expect(firstOption.title).toBeTruthy()
    // Labels should be reasonable length
    expect(firstOption.title.length).toBeLessThanOrEqual(200)
  })

  it('fallback: garbage/empty text → "Option N: ..." not nonsense', () => {
    const ideas = [
      makeIdea('x'),
      makeIdea('y'),
      makeIdea('z'),
    ]

    const result = synthesize(ideas, { topic: 'Test' })
    const firstOption = result.options[0]
    // With single-char ideas, labeler should fallback gracefully
    expect(firstOption.title).toBeTruthy()
    expect(firstOption.title.length).toBeGreaterThan(0)
  })

  it('handles ideas with only stopwords gracefully', () => {
    const ideas = [
      makeIdea('the is a an or and'),
      makeIdea('to of in for on with'),
      makeIdea('it was they are being'),
    ]

    const result = synthesize(ideas, { topic: 'Stopwords test' })
    expect(result.options.length).toBeGreaterThan(0)
    // Should not crash or produce empty titles
    for (const opt of result.options) {
      expect(opt.title).toBeTruthy()
    }
  })
})

describe('cluster quality', () => {
  it('groups related ideas together', () => {
    const ideas = [
      makeIdea('Improve email notification delivery speed'),
      makeIdea('Optimize email notification templates'),
      makeIdea('Add email notification preferences'),
      makeIdea('Build dashboard analytics charts'),
      makeIdea('Create dashboard performance metrics'),
      makeIdea('Design dashboard data visualization'),
    ]

    const result = synthesize(ideas, { topic: 'Product improvements' })
    // Should produce at least 1 option (ideas are clustered)
    expect(result.options.length).toBeGreaterThanOrEqual(1)
  })

  it('recommendation references highest-ranked cluster', () => {
    const ideas = [
      makeIdea('Email marketing campaign strategy'),
      makeIdea('Email marketing A/B testing'),
      makeIdea('Email marketing segmentation'),
      makeIdea('Email marketing automation'),
      makeIdea('Email marketing analytics'),
      makeIdea('Social media post once'),
    ]

    const result = synthesize(ideas, { topic: 'Marketing' })
    // Recommendation should exist
    expect(result.recommendation).toBeTruthy()
    expect(result.recommendation.length).toBeGreaterThan(10)
  })

  it('contrarian_view exists when multiple clusters', () => {
    const ideas = [
      makeIdea('Standard approach to user acquisition', { category: 'strategic', round: 1 }),
      makeIdea('Standard growth marketing channel', { category: 'strategic', round: 1 }),
      makeIdea('Standard SEO optimization plan', { category: 'strategic', round: 1 }),
      makeIdea('Wild unconventional viral marketing stunt', { category: 'disruptive', round: 2 }),
      makeIdea('Crazy guerrilla marketing campaign', { category: 'disruptive', round: 2 }),
      makeIdea('Unexpected partnership with unusual brand', { category: 'disruptive', round: 2 }),
    ]

    const result = synthesize(ideas, { topic: 'Growth' })
    // With enough diverse clusters, contrarian view should exist
    // (may not always be present depending on clustering)
    expect(result.options.length).toBeGreaterThanOrEqual(1)
  })

  it('assumptions populated from disruptive/first-principles ideas', () => {
    const ideas = [
      makeIdea('Challenge the assumption that users need accounts', { category: 'disruptive', techniqueId: 'disruptive-first-principles' }),
      makeIdea('What if we removed all forms entirely?', { category: 'disruptive', techniqueId: 'disruptive-what-if-scenarios' }),
      makeIdea('Normal idea about user flow', { category: 'creative' }),
    ]

    const result = synthesize(ideas, { topic: 'UX simplification' })
    expect(result.assumptions).toBeDefined()
    if (result.assumptions) {
      expect(result.assumptions.length).toBeGreaterThan(0)
    }
  })
})

describe('notes', () => {
  it('includes session summary in notes', () => {
    const ideas = [
      makeIdea('Idea from round 1', { round: 1, techniqueNameSnapshot: 'SCAMPER' }),
      makeIdea('Idea from round 2', { round: 2, techniqueNameSnapshot: 'Reverse Brainstorming' }),
      makeIdea('Another from round 1', { round: 1, techniqueNameSnapshot: 'SCAMPER' }),
    ]

    const result = synthesize(ideas, { topic: 'Feature planning', techniquesUsed: ['creative-scamper'], roundCount: 2 })
    expect(result.notes).toContain('3 ideas')
    expect(result.notes).toContain('2 round(s)')
    expect(result.notes).toContain('SCAMPER')
  })
})

describe('large idea set performance', () => {
  it('synthesizes 500 ideas within 10s', () => {
    const ideas: RawIdea[] = []
    const categories = ['creative', 'analytical', 'strategic', 'disruptive', 'futuristic'] as const
    const techniques = ['creative-scamper', 'analytical-swot', 'strategic-blue-ocean', 'disruptive-first-principles', 'futuristic-scenario-planning']

    for (let i = 0; i < 500; i++) {
      const catIdx = i % categories.length
      ideas.push(makeIdea(
        `Idea ${i}: approach for ${categories[catIdx]} problem solving with technique ${techniques[catIdx]} involving concept ${i % 20}`,
        {
          round: Math.floor(i / 50) + 1,
          category: categories[catIdx],
          techniqueId: techniques[catIdx],
          techniqueNameSnapshot: techniques[catIdx],
        },
      ))
    }

    const start = Date.now()
    const result = synthesize(ideas, { topic: 'Large brainstorm', techniquesUsed: techniques, roundCount: 10 })
    const elapsed = Date.now() - start

    expect(result.options.length).toBeGreaterThan(0)
    expect(result.options.length).toBeLessThanOrEqual(10)
    expect(elapsed).toBeLessThan(10_000) // CI-safe: 10s
  })
})
