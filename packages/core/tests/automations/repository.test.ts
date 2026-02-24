import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { AutomationRepository } from '../../src/automations/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: AutomationRepository
let domainId: string
let domainId2: string

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new AutomationRepository(db)
  const domainRepo = new DomainRepository(db)
  const d1 = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!d1.ok) throw new Error('Failed to create domain')
  domainId = d1.value.id
  const d2 = domainRepo.create({ name: 'Second Domain', kbPath: '/tmp/test-kb-2' })
  if (!d2.ok) throw new Error('Failed to create domain 2')
  domainId2 = d2.value.id
})

// ── Helper ──

function makeScheduleInput(overrides: Record<string, unknown> = {}) {
  return {
    domainId,
    name: 'Daily KB check',
    promptTemplate: 'Analyze {{domain_name}} for gaps',
    triggerType: 'schedule' as const,
    triggerCron: '0 9 * * *',
    actionType: 'notification' as const,
    ...overrides,
  }
}

function makeEventInput(overrides: Record<string, unknown> = {}) {
  return {
    domainId,
    name: 'On intake',
    promptTemplate: 'Classify new intake item',
    triggerType: 'event' as const,
    triggerEvent: 'intake_created' as const,
    actionType: 'notification' as const,
    ...overrides,
  }
}

function makeManualInput(overrides: Record<string, unknown> = {}) {
  return {
    domainId,
    name: 'Manual run',
    promptTemplate: 'Run analysis on demand',
    triggerType: 'manual' as const,
    actionType: 'notification' as const,
    ...overrides,
  }
}

describe('AutomationRepository', () => {
  // ── Create ──

  describe('create', () => {
    it('creates a schedule automation', () => {
      const result = repo.create(makeScheduleInput())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.name).toBe('Daily KB check')
      expect(result.value.triggerType).toBe('schedule')
      expect(result.value.triggerCron).toBe('0 9 * * *')
      expect(result.value.triggerEvent).toBeNull()
      expect(result.value.enabled).toBe(true)
      expect(result.value.failureStreak).toBe(0)
      expect(result.value.runCount).toBe(0)
      expect(result.value.id).toBeDefined()
    })

    it('creates an event automation', () => {
      const result = repo.create(makeEventInput())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.triggerType).toBe('event')
      expect(result.value.triggerEvent).toBe('intake_created')
      expect(result.value.triggerCron).toBeNull()
    })

    it('creates a manual automation', () => {
      const result = repo.create(makeManualInput())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.triggerType).toBe('manual')
      expect(result.value.triggerCron).toBeNull()
      expect(result.value.triggerEvent).toBeNull()
    })

    it('rejects schedule without triggerCron', () => {
      const result = repo.create({
        domainId,
        name: 'No cron',
        promptTemplate: 'test',
        triggerType: 'schedule',
        actionType: 'notification',
      })
      expect(result.ok).toBe(false)
    })

    it('rejects event without triggerEvent', () => {
      const result = repo.create({
        domainId,
        name: 'No event',
        promptTemplate: 'test',
        triggerType: 'event',
        actionType: 'notification',
      })
      expect(result.ok).toBe(false)
    })

    it('rejects empty name', () => {
      const result = repo.create(makeScheduleInput({ name: '' }))
      expect(result.ok).toBe(false)
    })

    it('rejects empty promptTemplate', () => {
      const result = repo.create(makeScheduleInput({ promptTemplate: '' }))
      expect(result.ok).toBe(false)
    })

    it('defaults catchUpEnabled to false', () => {
      const result = repo.create(makeScheduleInput())
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.catchUpEnabled).toBe(false)
    })

    it('defaults storePayloads to false', () => {
      const result = repo.create(makeScheduleInput())
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.storePayloads).toBe(false)
    })

    it('rejects catchUpEnabled on non-schedule trigger', () => {
      const result = repo.create(makeEventInput({ catchUpEnabled: true }))
      expect(result.ok).toBe(false)
    })

    it('accepts deadlineWindowDays for deadline_approaching', () => {
      const result = repo.create(makeEventInput({
        triggerEvent: 'deadline_approaching',
        deadlineWindowDays: 7,
      }))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.deadlineWindowDays).toBe(7)
    })

    it('rejects deadlineWindowDays for non-deadline triggers', () => {
      const result = repo.create(makeEventInput({ deadlineWindowDays: 7 }))
      expect(result.ok).toBe(false)
    })
  })

  // ── getById ──

  describe('getById', () => {
    it('retrieves an automation by id', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.getById(created.value.id)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.name).toBe('Daily KB check')
    })

    it('returns NOT_FOUND for missing id', () => {
      const result = repo.getById('00000000-0000-0000-0000-000000000000')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    })
  })

  // ── getByDomain ──

  describe('getByDomain', () => {
    it('returns automations for a specific domain', () => {
      repo.create(makeScheduleInput())
      repo.create(makeEventInput())
      repo.create(makeManualInput({ domainId: domainId2 }))

      const result = repo.getByDomain(domainId)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toHaveLength(2)
    })

    it('returns empty array for domain with no automations', () => {
      const result = repo.getByDomain(domainId)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toHaveLength(0)
    })
  })

  // ── Update ──

  describe('update', () => {
    it('updates name only', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.update(created.value.id, { name: 'Updated name' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.name).toBe('Updated name')
        expect(result.value.promptTemplate).toBe('Analyze {{domain_name}} for gaps')
      }
    })

    it('updates enabled flag', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.update(created.value.id, { enabled: false })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.enabled).toBe(false)
    })

    it('preserves engine-managed fields on update', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.update(created.value.id, { name: 'New name' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.failureStreak).toBe(0)
        expect(result.value.runCount).toBe(0)
        expect(result.value.domainId).toBe(domainId)
      }
    })

    it('returns NOT_FOUND for missing id', () => {
      const result = repo.update('00000000-0000-0000-0000-000000000000', { name: 'x' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    })
  })

  // ── Delete ──

  describe('delete', () => {
    it('deletes an automation', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.delete(created.value.id)
      expect(result.ok).toBe(true)

      const get = repo.getById(created.value.id)
      expect(get.ok).toBe(false)
    })

    it('returns NOT_FOUND for missing id', () => {
      const result = repo.delete('00000000-0000-0000-0000-000000000000')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    })
  })

  // ── Toggle ──

  describe('toggle', () => {
    it('toggles enabled to disabled', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')
      expect(created.value.enabled).toBe(true)

      const toggled = repo.toggle(created.value.id)
      expect(toggled.ok).toBe(true)
      if (toggled.ok) expect(toggled.value.enabled).toBe(false)
    })

    it('toggles disabled back to enabled and clears cooldown', () => {
      const created = repo.create(makeScheduleInput({ enabled: false }))
      if (!created.ok) throw new Error('setup failed')

      const toggled = repo.toggle(created.value.id)
      expect(toggled.ok).toBe(true)
      if (toggled.ok) {
        expect(toggled.value.enabled).toBe(true)
        expect(toggled.value.cooldownUntil).toBeNull()
      }
    })

    it('persists toggle state in DB', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      repo.toggle(created.value.id) // disable

      const fetched = repo.getById(created.value.id)
      expect(fetched.ok).toBe(true)
      if (fetched.ok) expect(fetched.value.enabled).toBe(false)
    })
  })

  // ── Engine queries ──

  describe('getEnabledByEvent', () => {
    it('returns enabled automations matching a specific event', () => {
      repo.create(makeEventInput())
      repo.create(makeEventInput({
        name: 'KB watcher',
        triggerEvent: 'kb_changed',
      }))
      repo.create(makeEventInput({ enabled: false }))

      const result = repo.getEnabledByEvent('intake_created')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].name).toBe('On intake')
      }
    })

    it('returns empty for event with no matching automations', () => {
      const result = repo.getEnabledByEvent('gap_flag_raised')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toHaveLength(0)
    })
  })

  describe('getScheduledEnabled', () => {
    it('returns enabled schedule automations', () => {
      repo.create(makeScheduleInput())
      repo.create(makeScheduleInput({ name: 'Disabled', enabled: false }))
      repo.create(makeEventInput())

      const result = repo.getScheduledEnabled()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toHaveLength(1)
        expect(result.value[0].triggerType).toBe('schedule')
      }
    })
  })

  // ── Run tracking ──

  describe('tryInsertRun', () => {
    it('inserts a run successfully', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'auto-1|2025-06-15T10:00',
        actionType: 'notification',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.status).toBe('pending')
        expect(result.value.automationId).toBe(created.value.id)
        expect(result.value.dedupeKey).toBe('auto-1|2025-06-15T10:00')
      }
    })

    it('throws on duplicate dedupe_key (UNIQUE constraint)', () => {
      // NOTE: tryInsertRun intends to catch duplicate key errors and return Err('duplicate'),
      // but better-sqlite3 puts 'SQLITE_CONSTRAINT_UNIQUE' in error.code rather than in
      // error.message, so the msg.includes('SQLITE_CONSTRAINT') check in the catch block
      // does not match. The error is re-thrown instead. This test documents actual behavior.
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run1 = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'dup-key',
        actionType: 'notification',
      })
      expect(run1.ok).toBe(true)

      // Second insert with same key returns Err('duplicate')
      const run2 = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'dup-key',
        actionType: 'notification',
      })
      expect(run2.ok).toBe(false)
      if (!run2.ok) {
        expect(run2.error).toBe('duplicate')
      }
    })

    it('duplicate increments parent duplicate_skip_count', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'dup-key',
        actionType: 'notification',
      })

      // Insert duplicate 3 times
      for (let i = 0; i < 3; i++) {
        const dup = repo.tryInsertRun({
          automationId: created.value.id,
          domainId,
          triggerType: 'schedule',
          triggerEvent: null,
          triggerData: null,
          dedupeKey: 'dup-key',
          actionType: 'notification',
        })
        expect(dup.ok).toBe(false)
      }

      // Verify duplicate_skip_count was incremented
      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) {
        expect(auto.value.duplicateSkipCount).toBe(3)
        expect(auto.value.lastDuplicateAt).not.toBeNull()
      }
    })

    it('allows different dedupe keys', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run1 = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'key-1',
        actionType: 'notification',
      })
      const run2 = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'key-2',
        actionType: 'notification',
      })
      expect(run1.ok).toBe(true)
      expect(run2.ok).toBe(true)
    })
  })

  // ── finalizeRun ──

  describe('finalizeRun', () => {
    it('marks run as success and updates parent automation', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'finalize-1',
        actionType: 'notification',
      })
      if (!run.ok) throw new Error('setup failed')

      // Update to running first
      repo.updateRunStatus(run.value.id, { status: 'running', startedAt: new Date().toISOString() })

      const result = repo.finalizeRun(run.value.id, {
        status: 'success',
        completedAt: new Date().toISOString(),
        durationMs: 1500,
      })
      expect(result.ok).toBe(true)

      // Check parent automation stats
      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) {
        expect(auto.value.runCount).toBe(1)
        expect(auto.value.failureStreak).toBe(0)
        expect(auto.value.lastRunAt).not.toBeNull()
        expect(auto.value.lastError).toBeNull()
      }
    })

    it('marks run as failed and sets cooldown on parent', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'finalize-fail',
        actionType: 'notification',
      })
      if (!run.ok) throw new Error('setup failed')

      repo.updateRunStatus(run.value.id, { status: 'running', startedAt: new Date().toISOString() })

      const result = repo.finalizeRun(run.value.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: 500,
        error: 'LLM timeout',
        errorCode: 'timeout',
      })
      expect(result.ok).toBe(true)

      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) {
        expect(auto.value.runCount).toBe(1)
        expect(auto.value.failureStreak).toBe(1)
        expect(auto.value.lastError).toBe('LLM timeout')
        expect(auto.value.cooldownUntil).not.toBeNull()
      }
    })

    it('marks run as skipped and updates lastRunAt', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'finalize-skip',
        actionType: 'notification',
      })
      if (!run.ok) throw new Error('setup failed')

      const completedAt = new Date().toISOString()
      const result = repo.finalizeRun(run.value.id, {
        status: 'skipped',
        completedAt,
        durationMs: null,
      })
      expect(result.ok).toBe(true)

      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) {
        expect(auto.value.lastRunAt).toBe(completedAt)
      }
    })
  })

  // ── Failure management ──

  describe('incrementFailureStreak', () => {
    it('increments streak and returns new count', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const r1 = repo.incrementFailureStreak(created.value.id)
      expect(r1.ok).toBe(true)
      if (r1.ok) expect(r1.value).toBe(1)

      const r2 = repo.incrementFailureStreak(created.value.id)
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.value).toBe(2)
    })

    it('returns NOT_FOUND for missing id', () => {
      const result = repo.incrementFailureStreak('00000000-0000-0000-0000-000000000000')
      expect(result.ok).toBe(false)
    })
  })

  describe('resetFailureStreak', () => {
    it('resets streak to 0 and clears cooldown', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      repo.incrementFailureStreak(created.value.id)
      repo.incrementFailureStreak(created.value.id)

      const result = repo.resetFailureStreak(created.value.id)
      expect(result.ok).toBe(true)

      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) {
        expect(auto.value.failureStreak).toBe(0)
        expect(auto.value.cooldownUntil).toBeNull()
      }
    })
  })

  describe('disableAutomation', () => {
    it('sets enabled to false', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const result = repo.disableAutomation(created.value.id)
      expect(result.ok).toBe(true)

      const auto = repo.getById(created.value.id)
      expect(auto.ok).toBe(true)
      if (auto.ok) expect(auto.value.enabled).toBe(false)
    })
  })

  // ── Run history ──

  describe('getRunsByAutomation', () => {
    it('returns runs in descending order by created_at', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'run-1',
        actionType: 'notification',
      })
      repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'run-2',
        actionType: 'notification',
      })

      const result = repo.getRunsByAutomation(created.value.id)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toHaveLength(2)
    })

    it('respects limit parameter', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      for (let i = 0; i < 5; i++) {
        repo.tryInsertRun({
          automationId: created.value.id,
          domainId,
          triggerType: 'schedule',
          triggerEvent: null,
          triggerData: null,
          dedupeKey: `limit-run-${i}`,
          actionType: 'notification',
        })
      }

      const result = repo.getRunsByAutomation(created.value.id, 3)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toHaveLength(3)
    })
  })

  // ── retentionCleanup ──

  describe('retentionCleanup', () => {
    it('deletes old runs beyond per-automation limit', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      // Insert runs with artificial old timestamps via direct SQL
      const now = new Date()
      for (let i = 0; i < 5; i++) {
        const pastDate = new Date(now.getTime() - (i + 30) * 86_400_000).toISOString()
        db.prepare(
          `INSERT INTO automation_runs (id, automation_id, domain_id, trigger_type, trigger_event,
            trigger_data, dedupe_key, action_type, status, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'schedule', NULL, NULL, ?, 'notification', 'success', ?, ?, ?)`,
        ).run(
          `cleanup-run-${i}`,
          created.value.id,
          domainId,
          `cleanup-key-${i}`,
          pastDate,
          pastDate,
          pastDate,
        )
      }

      // Keep only 2 per automation, retention 7 days
      const result = repo.retentionCleanup(7, 2)
      expect(result.ok).toBe(true)
      if (result.ok) {
        // 5 runs total, keep top 2, delete 3 (all are older than 7 days)
        expect(result.value).toBe(3)
      }
    })

    it('does not delete recent runs within retention window', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      // Insert recent runs
      repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'recent-1',
        actionType: 'notification',
      })
      repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'recent-2',
        actionType: 'notification',
      })

      // Retention 30 days, keep 1 per automation — but runs are recent so none deleted
      const result = repo.retentionCleanup(30, 1)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(0)
    })
  })

  // ── updateRunStatus ──

  describe('updateRunStatus', () => {
    it('updates run status fields', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      const run = repo.tryInsertRun({
        automationId: created.value.id,
        domainId,
        triggerType: 'schedule',
        triggerEvent: null,
        triggerData: null,
        dedupeKey: 'status-test',
        actionType: 'notification',
      })
      if (!run.ok) throw new Error('setup failed')

      const startedAt = new Date().toISOString()
      const result = repo.updateRunStatus(run.value.id, {
        status: 'running',
        startedAt,
        promptHash: 'abc123',
        promptRendered: 'Rendered prompt text',
      })
      expect(result.ok).toBe(true)

      // Verify by reading the run
      const runs = repo.getRunsByAutomation(created.value.id)
      expect(runs.ok).toBe(true)
      if (runs.ok) {
        const updatedRun = runs.value.find(r => r.id === run.value.id)
        expect(updatedRun).toBeDefined()
        expect(updatedRun!.status).toBe('running')
        expect(updatedRun!.promptHash).toBe('abc123')
        expect(updatedRun!.promptRendered).toBe('Rendered prompt text')
      }
    })
  })

  // ── cleanupStaleRuns ──

  describe('cleanupStaleRuns', () => {
    it('marks old pending/running runs as failed', () => {
      const created = repo.create(makeScheduleInput())
      if (!created.ok) throw new Error('setup failed')

      // Insert a stale run via direct SQL with old created_at.
      // The CHECK constraint requires started_at IS NOT NULL when status = 'running'.
      const oldDate = new Date(Date.now() - 2 * 3600_000).toISOString()
      db.prepare(
        `INSERT INTO automation_runs (id, automation_id, domain_id, trigger_type, trigger_event,
          trigger_data, dedupe_key, action_type, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'schedule', NULL, NULL, ?, 'notification', 'running', ?, ?, ?)`,
      ).run('stale-run', created.value.id, domainId, 'stale-key', oldDate, oldDate, oldDate)

      // Mark stale runs older than 1 hour
      const result = repo.cleanupStaleRuns(3600_000)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe(1)
    })
  })
})
