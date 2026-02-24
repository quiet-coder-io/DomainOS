/**
 * Engine-adjacent integration tests.
 *
 * The actual AutomationEngine lives in the Electron desktop app (depends on
 * BrowserWindow / IPC), so we cannot import it in a pure Node test. Instead,
 * these tests validate the underlying logic that the engine relies on:
 *   - Dedupe key uniqueness via the repository
 *   - Failure streak / cooldown behavior
 *   - Privacy: store_payloads=0 means triggerData is not persisted
 *   - Rate-limit concepts via duplicate detection
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { AutomationRepository } from '../../src/automations/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import { generateDedupeKey } from '../../src/automations/dedupe.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: AutomationRepository
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new AutomationRepository(db)
  const domainRepo = new DomainRepository(db)
  const d1 = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!d1.ok) throw new Error('Failed to create domain')
  domainId = d1.value.id
})

function makeScheduleAutomation(overrides: Record<string, unknown> = {}) {
  return {
    domainId,
    name: 'Engine test auto',
    promptTemplate: 'Test prompt',
    triggerType: 'schedule' as const,
    triggerCron: '0 9 * * *',
    actionType: 'notification' as const,
    ...overrides,
  }
}

describe('Dedupe key uniqueness via repository', () => {
  it('generates unique keys for different schedule minutes', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    const key1 = generateDedupeKey(created.value.id, 'schedule', { minuteKey: '2025-06-15T09:00' })
    const key2 = generateDedupeKey(created.value.id, 'schedule', { minuteKey: '2025-06-15T09:01' })
    expect(key1).not.toBe(key2)

    const run1 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key1,
      actionType: 'notification',
    })
    const run2 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key2,
      actionType: 'notification',
    })

    expect(run1.ok).toBe(true)
    expect(run2.ok).toBe(true)
  })

  it('blocks duplicate schedule run for the same minute via UNIQUE constraint', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    const key = generateDedupeKey(created.value.id, 'schedule', { minuteKey: '2025-06-15T09:00' })

    const run1 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key,
      actionType: 'notification',
    })
    expect(run1.ok).toBe(true)

    // The UNIQUE index on dedupe_key prevents duplicate inserts.
    const dup = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key,
      actionType: 'notification',
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toBe('duplicate')
  })

  it('allows same event data at different minutes (time-windowed dedupe)', () => {
    const created = repo.create({
      domainId,
      name: 'Event test',
      promptTemplate: 'Test',
      triggerType: 'event',
      triggerEvent: 'intake_created',
      actionType: 'notification',
    })
    if (!created.ok) throw new Error('setup failed')

    const eventData = { entityId: 'e1', entityType: 'intake' }

    const key1 = generateDedupeKey(created.value.id, 'event', {
      minuteKey: '2025-06-15T09:00',
      eventType: 'intake_created',
      eventData,
    })
    const key2 = generateDedupeKey(created.value.id, 'event', {
      minuteKey: '2025-06-15T09:01',
      eventType: 'intake_created',
      eventData,
    })

    expect(key1).not.toBe(key2) // Different minute windows

    const run1 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'event',
      triggerEvent: 'intake_created',
      triggerData: JSON.stringify(eventData),
      dedupeKey: key1,
      actionType: 'notification',
    })
    const run2 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'event',
      triggerEvent: 'intake_created',
      triggerData: JSON.stringify(eventData),
      dedupeKey: key2,
      actionType: 'notification',
    })

    expect(run1.ok).toBe(true)
    expect(run2.ok).toBe(true)
  })
})

describe('Failure streak and cooldown behavior', () => {
  it('successive failures increment the streak', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    repo.incrementFailureStreak(created.value.id)
    repo.incrementFailureStreak(created.value.id)
    repo.incrementFailureStreak(created.value.id)

    const auto = repo.getById(created.value.id)
    expect(auto.ok).toBe(true)
    if (auto.ok) expect(auto.value.failureStreak).toBe(3)
  })

  it('a successful run resets failure streak via finalizeRun', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    // Build up a failure streak
    repo.incrementFailureStreak(created.value.id)
    repo.incrementFailureStreak(created.value.id)

    // Now run a successful execution
    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'success-after-fail',
      actionType: 'notification',
    })
    if (!run.ok) throw new Error('setup failed')

    repo.updateRunStatus(run.value.id, { status: 'running', startedAt: new Date().toISOString() })
    repo.finalizeRun(run.value.id, {
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs: 1000,
    })

    const auto = repo.getById(created.value.id)
    expect(auto.ok).toBe(true)
    if (auto.ok) expect(auto.value.failureStreak).toBe(0)
  })

  it('finalizeRun with failed status sets cooldown_until', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'fail-cooldown',
      actionType: 'notification',
    })
    if (!run.ok) throw new Error('setup failed')

    repo.updateRunStatus(run.value.id, { status: 'running', startedAt: new Date().toISOString() })
    repo.finalizeRun(run.value.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 500,
      error: 'Timeout',
    })

    const auto = repo.getById(created.value.id)
    expect(auto.ok).toBe(true)
    if (auto.ok) {
      expect(auto.value.cooldownUntil).not.toBeNull()
      // Cooldown should be in the future
      const cooldownDate = new Date(auto.value.cooldownUntil!)
      expect(cooldownDate.getTime()).toBeGreaterThan(Date.now())
    }
  })

  it('exponential backoff increases cooldown with each failure', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    // First failure
    const run1 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'backoff-1',
      actionType: 'notification',
    })
    if (!run1.ok) throw new Error('setup failed')
    repo.updateRunStatus(run1.value.id, { status: 'running', startedAt: new Date().toISOString() })
    repo.finalizeRun(run1.value.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 100,
      error: 'Error 1',
    })

    const after1 = repo.getById(created.value.id)
    if (!after1.ok) throw new Error('read failed')
    const cooldown1 = new Date(after1.value.cooldownUntil!).getTime()

    // Second failure
    const run2 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'backoff-2',
      actionType: 'notification',
    })
    if (!run2.ok) throw new Error('setup failed')
    repo.updateRunStatus(run2.value.id, { status: 'running', startedAt: new Date().toISOString() })
    repo.finalizeRun(run2.value.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 100,
      error: 'Error 2',
    })

    const after2 = repo.getById(created.value.id)
    if (!after2.ok) throw new Error('read failed')
    const cooldown2 = new Date(after2.value.cooldownUntil!).getTime()

    // Second cooldown should be further in the future than first
    expect(cooldown2).toBeGreaterThan(cooldown1)
    expect(after2.value.failureStreak).toBe(2)
  })

  it('disableAutomation prevents it from appearing in engine queries', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    repo.disableAutomation(created.value.id)

    const scheduled = repo.getScheduledEnabled()
    expect(scheduled.ok).toBe(true)
    if (scheduled.ok) expect(scheduled.value).toHaveLength(0)
  })

  it('toggle re-enable clears cooldown so engine can pick it up again', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    // Simulate cooldown by failing
    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'toggle-test',
      actionType: 'notification',
    })
    if (!run.ok) throw new Error('setup failed')
    repo.updateRunStatus(run.value.id, { status: 'running', startedAt: new Date().toISOString() })
    repo.finalizeRun(run.value.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 100,
      error: 'Error',
    })

    // Verify cooldown is set
    const beforeToggle = repo.getById(created.value.id)
    if (!beforeToggle.ok) throw new Error('read failed')
    expect(beforeToggle.value.cooldownUntil).not.toBeNull()

    // Disable then re-enable
    repo.toggle(created.value.id) // disable
    const disabled = repo.toggle(created.value.id) // re-enable
    expect(disabled.ok).toBe(true)
    if (disabled.ok) {
      expect(disabled.value.enabled).toBe(true)
      expect(disabled.value.cooldownUntil).toBeNull()
    }
  })
})

describe('Privacy: store_payloads=0 behavior', () => {
  it('can insert run with null triggerData when store_payloads is false', () => {
    const created = repo.create(makeScheduleAutomation({ storePayloads: false }))
    if (!created.ok) throw new Error('setup failed')
    expect(created.value.storePayloads).toBe(false)

    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null, // No payload stored
      dedupeKey: 'privacy-null',
      actionType: 'notification',
    })
    expect(run.ok).toBe(true)
    if (run.ok) expect(run.value.triggerData).toBeNull()
  })

  it('store_payloads=1 allows triggerData to be persisted', () => {
    const created = repo.create({
      domainId,
      name: 'Payload storing auto',
      promptTemplate: 'Test',
      triggerType: 'event',
      triggerEvent: 'intake_created',
      actionType: 'notification',
      storePayloads: true,
    })
    if (!created.ok) throw new Error('setup failed')
    expect(created.value.storePayloads).toBe(true)

    const payloadJson = JSON.stringify({ entityId: 'e1', content: 'Some intake data' })
    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'event',
      triggerEvent: 'intake_created',
      triggerData: payloadJson,
      dedupeKey: 'privacy-stored',
      actionType: 'notification',
    })
    expect(run.ok).toBe(true)
    if (run.ok) expect(run.value.triggerData).toBe(payloadJson)
  })

  it('LLM response storage respects privacy — null when not stored', () => {
    const created = repo.create(makeScheduleAutomation({ storePayloads: false }))
    if (!created.ok) throw new Error('setup failed')

    const run = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: 'llm-privacy',
      actionType: 'notification',
    })
    if (!run.ok) throw new Error('setup failed')

    // Simulate engine choosing not to store LLM response (privacy mode)
    repo.updateRunStatus(run.value.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      promptRendered: null as unknown as string, // Engine would not set this
    })

    const runs = repo.getRunsByAutomation(created.value.id)
    expect(runs.ok).toBe(true)
    if (runs.ok) {
      const theRun = runs.value.find(r => r.id === run.value.id)
      expect(theRun).toBeDefined()
      expect(theRun!.promptRendered).toBeNull()
      expect(theRun!.llmResponse).toBeNull()
    }
  })
})

describe('Rate-limit concepts via duplicate detection', () => {
  it('same automation + same minuteKey = blocked via UNIQUE constraint (per-minute rate limit)', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    const minuteKey = '2025-06-15T09:00'
    const key = generateDedupeKey(created.value.id, 'schedule', { minuteKey })

    // First run at this minute: allowed
    const r1 = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key,
      actionType: 'notification',
    })
    expect(r1.ok).toBe(true)

    // Second run at same minute: blocked by UNIQUE index
    const dup = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key,
      actionType: 'notification',
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toBe('duplicate')
  })

  it('different automations with same minuteKey are independent', () => {
    const auto1 = repo.create(makeScheduleAutomation({ name: 'Auto 1' }))
    const auto2 = repo.create(makeScheduleAutomation({ name: 'Auto 2' }))
    if (!auto1.ok || !auto2.ok) throw new Error('setup failed')

    const minuteKey = '2025-06-15T09:00'
    const key1 = generateDedupeKey(auto1.value.id, 'schedule', { minuteKey })
    const key2 = generateDedupeKey(auto2.value.id, 'schedule', { minuteKey })

    expect(key1).not.toBe(key2) // Different automation IDs produce different keys

    const r1 = repo.tryInsertRun({
      automationId: auto1.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key1,
      actionType: 'notification',
    })
    const r2 = repo.tryInsertRun({
      automationId: auto2.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key2,
      actionType: 'notification',
    })

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('UNIQUE constraint prevents duplicate runs — returns Err(duplicate)', () => {
    const created = repo.create(makeScheduleAutomation())
    if (!created.ok) throw new Error('setup failed')

    const key = generateDedupeKey(created.value.id, 'schedule', { minuteKey: '2025-06-15T09:00' })

    const first = repo.tryInsertRun({
      automationId: created.value.id,
      domainId,
      triggerType: 'schedule',
      triggerEvent: null,
      triggerData: null,
      dedupeKey: key,
      actionType: 'notification',
    })
    expect(first.ok).toBe(true)

    // Duplicate attempts return Err('duplicate')
    let dupeCount = 0
    for (let i = 0; i < 3; i++) {
      const dup = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: key,
        actionType: 'notification',
      })
      if (!dup.ok) dupeCount++
    }
    expect(dupeCount).toBe(3)

    // Only 1 run exists in the database
    const runs = repo.getRunsByAutomation(created.value.id)
    expect(runs.ok).toBe(true)
    if (runs.ok) expect(runs.value).toHaveLength(1)
  })
})
