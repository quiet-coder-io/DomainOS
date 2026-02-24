import { describe, it, expect } from 'vitest'
import {
  BrainstormStepSchema,
  BrainstormPhaseSchema,
  BrainstormErrorCodeSchema,
  RawIdeaSchema,
  BrainstormRoundSchema,
  BrainstormSessionSchema,
  CreateBrainstormSessionInputSchema,
  CaptureIdeasInputSchema,
  STEP_TRANSITIONS,
  PAUSABLE_STEPS,
  BRAINSTORM_IDEA_SOFT_CAP,
  BRAINSTORM_SCHEMA_VERSION,
} from '../../src/brainstorm/schemas.js'

describe('BrainstormStepSchema', () => {
  it('accepts valid steps', () => {
    for (const step of ['setup', 'technique_selection', 'execution', 'synthesis', 'completed']) {
      expect(BrainstormStepSchema.parse(step)).toBe(step)
    }
  })

  it('rejects invalid steps', () => {
    expect(() => BrainstormStepSchema.parse('invalid')).toThrow()
    expect(() => BrainstormStepSchema.parse('')).toThrow()
  })
})

describe('BrainstormPhaseSchema', () => {
  it('accepts divergent and convergent', () => {
    expect(BrainstormPhaseSchema.parse('divergent')).toBe('divergent')
    expect(BrainstormPhaseSchema.parse('convergent')).toBe('convergent')
  })

  it('rejects invalid phases', () => {
    expect(() => BrainstormPhaseSchema.parse('unknown')).toThrow()
  })
})

describe('BrainstormErrorCodeSchema', () => {
  it('accepts all error codes', () => {
    const codes = ['NO_SESSION', 'ILLEGAL_TRANSITION', 'INSUFFICIENT_IDEAS', 'CAP_REACHED', 'UNKNOWN_TECHNIQUE_ID', 'DB_CONSTRAINT']
    for (const code of codes) {
      expect(BrainstormErrorCodeSchema.parse(code)).toBe(code)
    }
  })
})

describe('RawIdeaSchema', () => {
  it('validates a well-formed idea', () => {
    const idea = {
      id: 'abc-123',
      text: 'Use gamification for onboarding',
      techniqueId: 'creative-scamper',
      techniqueNameSnapshot: 'SCAMPER',
      category: 'creative',
      round: 1,
      timestamp: '2026-02-24T00:00:00Z',
    }
    expect(RawIdeaSchema.parse(idea)).toEqual(idea)
  })

  it('rejects extra fields (strict)', () => {
    const idea = {
      id: 'abc-123',
      text: 'Test',
      techniqueId: 'test',
      techniqueNameSnapshot: 'Test',
      category: 'creative',
      round: 1,
      timestamp: '2026-02-24T00:00:00Z',
      extra: 'not allowed',
    }
    expect(() => RawIdeaSchema.parse(idea)).toThrow()
  })

  it('rejects text over 2000 chars', () => {
    const idea = {
      id: 'abc-123',
      text: 'x'.repeat(2001),
      techniqueId: 'test',
      techniqueNameSnapshot: 'Test',
      category: 'creative',
      round: 1,
      timestamp: '2026-02-24T00:00:00Z',
    }
    expect(() => RawIdeaSchema.parse(idea)).toThrow()
  })
})

describe('BrainstormRoundSchema', () => {
  it('validates a well-formed round', () => {
    const round = {
      roundNumber: 1,
      techniqueId: 'creative-scamper',
      techniqueNameSnapshot: 'SCAMPER',
      techniqueCategory: 'creative',
      ideaCount: 5,
      startedAt: '2026-02-24T00:00:00Z',
      completedAt: null,
    }
    expect(BrainstormRoundSchema.parse(round)).toEqual(round)
  })

  it('allows completedAt to be a string', () => {
    const round = {
      roundNumber: 1,
      techniqueId: 'test',
      techniqueNameSnapshot: 'Test',
      techniqueCategory: 'creative',
      ideaCount: 3,
      startedAt: '2026-02-24T00:00:00Z',
      completedAt: '2026-02-24T01:00:00Z',
    }
    expect(BrainstormRoundSchema.parse(round)).toEqual(round)
  })
})

describe('CreateBrainstormSessionInputSchema', () => {
  it('validates minimal input', () => {
    const input = { domainId: 'dom-1', topic: 'Improve onboarding' }
    const result = CreateBrainstormSessionInputSchema.parse(input)
    expect(result.domainId).toBe('dom-1')
    expect(result.topic).toBe('Improve onboarding')
    expect(result.goals).toBe('') // default
  })

  it('validates full input', () => {
    const input = { domainId: 'dom-1', topic: 'Improve onboarding', goals: 'Reduce churn by 20%', sessionId: 'sess-1' }
    const result = CreateBrainstormSessionInputSchema.parse(input)
    expect(result.goals).toBe('Reduce churn by 20%')
  })

  it('rejects empty topic', () => {
    expect(() => CreateBrainstormSessionInputSchema.parse({ domainId: 'dom-1', topic: '' })).toThrow()
  })

  it('rejects topic over 1000 chars', () => {
    expect(() => CreateBrainstormSessionInputSchema.parse({ domainId: 'dom-1', topic: 'x'.repeat(1001) })).toThrow()
  })
})

describe('CaptureIdeasInputSchema', () => {
  it('validates 1 idea', () => {
    const input = { ideas: [{ text: 'An idea' }] }
    expect(CaptureIdeasInputSchema.parse(input).ideas).toHaveLength(1)
  })

  it('validates 50 ideas (max)', () => {
    const ideas = Array.from({ length: 50 }, (_, i) => ({ text: `Idea ${i}` }))
    expect(CaptureIdeasInputSchema.parse({ ideas }).ideas).toHaveLength(50)
  })

  it('rejects 0 ideas', () => {
    expect(() => CaptureIdeasInputSchema.parse({ ideas: [] })).toThrow()
  })

  it('rejects 51 ideas', () => {
    const ideas = Array.from({ length: 51 }, (_, i) => ({ text: `Idea ${i}` }))
    expect(() => CaptureIdeasInputSchema.parse({ ideas })).toThrow()
  })

  it('rejects empty idea text', () => {
    expect(() => CaptureIdeasInputSchema.parse({ ideas: [{ text: '' }] })).toThrow()
  })
})

describe('STEP_TRANSITIONS', () => {
  it('setup only goes to technique_selection', () => {
    expect(STEP_TRANSITIONS.setup).toEqual(['technique_selection'])
  })

  it('completed is terminal (no outgoing edges)', () => {
    expect(STEP_TRANSITIONS.completed).toEqual([])
  })

  it('technique_selection can go to execution or setup', () => {
    expect(STEP_TRANSITIONS.technique_selection).toContain('execution')
    expect(STEP_TRANSITIONS.technique_selection).toContain('setup')
  })

  it('execution can go to technique_selection or synthesis', () => {
    expect(STEP_TRANSITIONS.execution).toContain('technique_selection')
    expect(STEP_TRANSITIONS.execution).toContain('synthesis')
  })

  it('synthesis goes to completed', () => {
    expect(STEP_TRANSITIONS.synthesis).toEqual(['completed'])
  })
})

describe('PAUSABLE_STEPS', () => {
  it('includes technique_selection, execution, synthesis', () => {
    expect(PAUSABLE_STEPS).toContain('technique_selection')
    expect(PAUSABLE_STEPS).toContain('execution')
    expect(PAUSABLE_STEPS).toContain('synthesis')
  })

  it('does not include setup or completed', () => {
    expect(PAUSABLE_STEPS).not.toContain('setup')
    expect(PAUSABLE_STEPS).not.toContain('completed')
  })
})

describe('Constants', () => {
  it('BRAINSTORM_IDEA_SOFT_CAP is 500', () => {
    expect(BRAINSTORM_IDEA_SOFT_CAP).toBe(500)
  })

  it('BRAINSTORM_SCHEMA_VERSION is 1', () => {
    expect(BRAINSTORM_SCHEMA_VERSION).toBe(1)
  })
})
