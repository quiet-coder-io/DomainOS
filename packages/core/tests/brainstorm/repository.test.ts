import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/database.js'
import { BrainstormSessionRepository } from '../../src/brainstorm/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: BrainstormSessionRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new BrainstormSessionRepository(db)

  // Seed a domain for FK constraints
  const domainRepo = new DomainRepository(db)
  domainRepo.create({ name: 'Test Domain', description: 'Test', kbPath: '/tmp/test' })
})

function getTestDomainId(): string {
  const row = db.prepare("SELECT id FROM domains WHERE name = 'Test Domain'").get() as { id: string }
  return row.id
}

describe('create', () => {
  it('creates a session with defaults', () => {
    const domainId = getTestDomainId()
    const result = repo.create({ domainId, topic: 'Improve onboarding', goals: '' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.topic).toBe('Improve onboarding')
    expect(result.value.step).toBe('setup')
    expect(result.value.phase).toBe('divergent')
    expect(result.value.isPaused).toBe(false)
    expect(result.value.ideaCount).toBe(0)
    expect(result.value.selectedTechniques).toEqual([])
    expect(result.value.rounds).toEqual([])
    expect(result.value.rawIdeas).toEqual([])
  })

  it('rejects empty topic', () => {
    const domainId = getTestDomainId()
    const result = repo.create({ domainId, topic: '', goals: '' })
    expect(result.ok).toBe(false)
  })
})

describe('unique active invariant', () => {
  it('rejects second active session for same domain', () => {
    const domainId = getTestDomainId()
    const first = repo.create({ domainId, topic: 'Topic 1', goals: '' })
    expect(first.ok).toBe(true)

    const second = repo.create({ domainId, topic: 'Topic 2', goals: '' })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.message).toContain('BRAINSTORM')
    }
  })

  it('allows new session after previous is completed', () => {
    const domainId = getTestDomainId()
    const first = repo.create({ domainId, topic: 'Topic 1', goals: '' })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    repo.close(first.value.id)

    const second = repo.create({ domainId, topic: 'Topic 2', goals: '' })
    expect(second.ok).toBe(true)
  })

  it('getActive returns paused sessions (holds the slot)', () => {
    const domainId = getTestDomainId()
    const created = repo.create({ domainId, topic: 'Topic', goals: '' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Advance to execution so we can pause
    repo.setStep(created.value.id, 'technique_selection')
    repo.updateSelectedTechniques(created.value.id, ['creative-scamper'])
    repo.setStep(created.value.id, 'execution')
    repo.pause(created.value.id)

    const active = repo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (!active.ok) return
    expect(active.value).not.toBeNull()
    expect(active.value!.isPaused).toBe(true)
  })
})

describe('setStep (transition graph)', () => {
  it('allows setup → technique_selection', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const result = repo.setStep(session.value.id, 'technique_selection')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.step).toBe('technique_selection')
  })

  it('rejects setup → execution (illegal transition)', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const result = repo.setStep(session.value.id, 'execution')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('ILLEGAL_TRANSITION')
  })

  it('rejects setup → synthesis (illegal transition)', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const result = repo.setStep(session.value.id, 'synthesis')
    expect(result.ok).toBe(false)
  })

  it('rejects completed → anything (terminal state)', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    repo.close(session.value.id)

    // Try all steps from completed
    for (const step of ['setup', 'technique_selection', 'execution', 'synthesis'] as const) {
      const result = repo.setStep(session.value.id, step)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects synthesis with < 3 ideas', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    repo.setStep(session.value.id, 'technique_selection')
    repo.updateSelectedTechniques(session.value.id, ['creative-scamper'])
    repo.setStep(session.value.id, 'execution')

    const result = repo.setStep(session.value.id, 'synthesis')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('INSUFFICIENT_IDEAS')
  })

  it('updates phase to convergent on synthesis', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    repo.setStep(session.value.id, 'technique_selection')
    repo.updateSelectedTechniques(session.value.id, ['creative-scamper'])
    repo.setStep(session.value.id, 'execution')

    // Add 3 ideas to meet threshold
    repo.addIdeas(session.value.id, [{ text: 'Idea 1' }, { text: 'Idea 2' }, { text: 'Idea 3' }], 'creative-scamper')

    const result = repo.setStep(session.value.id, 'synthesis')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.phase).toBe('convergent')
  })
})

describe('pause/resume idempotency', () => {
  function createPausableSession() {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    if (!session.ok) throw new Error('Failed to create session')
    repo.setStep(session.value.id, 'technique_selection')
    repo.updateSelectedTechniques(session.value.id, ['creative-scamper'])
    repo.setStep(session.value.id, 'execution')
    return session.value.id
  }

  it('pause when already paused = success (idempotent)', () => {
    const id = createPausableSession()
    const first = repo.pause(id)
    expect(first.ok).toBe(true)

    const second = repo.pause(id)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.value.isPaused).toBe(true)
  })

  it('resume when already running = success (idempotent)', () => {
    const id = createPausableSession()
    // Not paused yet
    const result = repo.resume(id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.isPaused).toBe(false)
  })

  it('pause closes open round', () => {
    const id = createPausableSession()
    // Add ideas to create a round
    repo.addIdeas(id, [{ text: 'Test idea' }], 'creative-scamper')

    const beforePause = repo.getById(id)
    expect(beforePause.ok).toBe(true)
    if (!beforePause.ok) return
    expect(beforePause.value.rounds.some((r) => r.completedAt === null)).toBe(true)

    repo.pause(id)
    const afterPause = repo.getById(id)
    expect(afterPause.ok).toBe(true)
    if (!afterPause.ok) return
    // All rounds should be closed after pause
    expect(afterPause.value.rounds.every((r) => r.completedAt !== null)).toBe(true)
  })

  it('resume does NOT reopen a round', () => {
    const id = createPausableSession()
    repo.addIdeas(id, [{ text: 'Test idea' }], 'creative-scamper')
    repo.pause(id)
    repo.resume(id)

    const session = repo.getById(id)
    expect(session.ok).toBe(true)
    if (!session.ok) return
    // All rounds still closed — resume doesn't reopen
    expect(session.value.rounds.every((r) => r.completedAt !== null)).toBe(true)
  })

  it('cannot pause in setup step', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const result = repo.pause(session.value.id)
    expect(result.ok).toBe(false)
  })
})

describe('addIdeas + auto-round creation', () => {
  function createSessionInExecution() {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    if (!session.ok) throw new Error('Failed to create session')
    repo.setStep(session.value.id, 'technique_selection')
    repo.updateSelectedTechniques(session.value.id, ['creative-scamper'])
    repo.setStep(session.value.id, 'execution')
    return session.value.id
  }

  it('capture_ideas without explicit round → round auto-created', () => {
    const id = createSessionInExecution()
    const result = repo.addIdeas(id, [{ text: 'First idea' }], 'creative-scamper')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.roundNumber).toBe(1)
    expect(result.value.session.rounds).toHaveLength(1)
    expect(result.value.session.ideaCount).toBe(1)
  })

  it('subsequent ideas go to same open round', () => {
    const id = createSessionInExecution()
    repo.addIdeas(id, [{ text: 'Idea 1' }], 'creative-scamper')
    const result = repo.addIdeas(id, [{ text: 'Idea 2' }], 'creative-scamper')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.roundNumber).toBe(1)
    expect(result.value.session.ideaCount).toBe(2)
    expect(result.value.session.rounds).toHaveLength(1) // Same round
  })

  it('different techniqueId creates new round', () => {
    const id = createSessionInExecution()
    repo.addIdeas(id, [{ text: 'Idea 1' }], 'creative-scamper')
    const result = repo.addIdeas(id, [{ text: 'Idea 2' }], 'creative-reverse-brainstorm')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.roundNumber).toBe(2)
    expect(result.value.session.rounds).toHaveLength(2)
    // First round should be closed
    expect(result.value.session.rounds[0].completedAt).not.toBeNull()
    // Second round should be open
    expect(result.value.session.rounds[1].completedAt).toBeNull()
  })

  it('captures up to 50 ideas per call', () => {
    const id = createSessionInExecution()
    const ideas = Array.from({ length: 50 }, (_, i) => ({ text: `Idea ${i}` }))
    const result = repo.addIdeas(id, ideas, 'creative-scamper')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.session.ideaCount).toBe(50)
  })

  it('rejects adding ideas to completed session', () => {
    const id = createSessionInExecution()
    repo.close(id)

    const result = repo.addIdeas(id, [{ text: 'Too late' }], 'creative-scamper')
    expect(result.ok).toBe(false)
  })
})

describe('500-idea cap', () => {
  it('returns CAP_REACHED when at soft cap', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    if (!session.ok) throw new Error('Failed to create session')

    repo.setStep(session.value.id, 'technique_selection')
    repo.updateSelectedTechniques(session.value.id, ['creative-scamper'])
    repo.setStep(session.value.id, 'execution')

    // Add 500 ideas in batches of 50
    for (let i = 0; i < 10; i++) {
      const ideas = Array.from({ length: 50 }, (_, j) => ({ text: `Idea ${i * 50 + j}` }))
      repo.addIdeas(session.value.id, ideas, 'creative-scamper')
    }

    // 501st should fail
    const result = repo.addIdeas(session.value.id, [{ text: 'One more' }], 'creative-scamper')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('CAP_REACHED')
  })
})

describe('close', () => {
  it('closes from any non-completed state', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const result = repo.close(session.value.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.closedSessionId).toBe(session.value.id)

    const closed = repo.getById(session.value.id)
    expect(closed.ok).toBe(true)
    if (closed.ok) expect(closed.value.step).toBe('completed')
  })

  it('close when already completed = success (idempotent)', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    repo.close(session.value.id)
    const second = repo.close(session.value.id)
    expect(second.ok).toBe(true)
  })

  it('close releases the active slot', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    repo.close(session.value.id)

    const active = repo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (active.ok) expect(active.value).toBeNull()
  })
})

describe('setSynthesisPreview', () => {
  it('stores preview and is recoverable', () => {
    const domainId = getTestDomainId()
    const session = repo.create({ domainId, topic: 'Test', goals: '' })
    expect(session.ok).toBe(true)
    if (!session.ok) return

    const preview = JSON.stringify({ schemaVersion: 1, payload: { topic: 'Test' }, hash: 'abc123' })
    const result = repo.setSynthesisPreview(session.value.id, preview)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.synthesisPreview).toBe(preview)

    // Still recoverable after close
    repo.close(session.value.id)
    const closed = repo.getById(session.value.id)
    expect(closed.ok).toBe(true)
    if (closed.ok) {
      expect(closed.value.synthesisPreview).toBe(preview)
      const parsed = JSON.parse(closed.value.synthesisPreview)
      expect(parsed.hash).toBe('abc123')
    }
  })
})

describe('session_control idempotency with no session', () => {
  it('getActive with no sessions returns null', () => {
    const active = repo.getActive('nonexistent-domain')
    expect(active.ok).toBe(true)
    if (active.ok) expect(active.value).toBeNull()
  })
})
