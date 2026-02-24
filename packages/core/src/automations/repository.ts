/**
 * Automation repository — CRUD, engine queries, run tracking, and cleanup.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { CreateAutomationInputSchema, UpdateAutomationInputSchema } from './schemas.js'
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
  TriggerType,
  TriggerEvent,
  ActionType,
  RunStatus,
  AutomationErrorCode,
} from './schemas.js'

// ── Row interfaces (snake_case DB columns) ──

interface AutomationRow {
  id: string
  domain_id: string
  name: string
  description: string
  trigger_type: string
  trigger_cron: string | null
  trigger_event: string | null
  prompt_template: string
  action_type: string
  action_config: string
  enabled: number
  catch_up_enabled: number
  store_payloads: number
  deadline_window_days: number | null
  next_run_at: string | null
  failure_streak: number
  cooldown_until: string | null
  last_run_at: string | null
  last_error: string | null
  run_count: number
  duplicate_skip_count: number
  last_duplicate_at: string | null
  created_at: string
  updated_at: string
}

interface AutomationRunRow {
  id: string
  automation_id: string
  domain_id: string
  trigger_type: string
  trigger_event: string | null
  trigger_data: string | null
  dedupe_key: string | null
  prompt_hash: string | null
  prompt_rendered: string | null
  response_hash: string | null
  llm_response: string | null
  action_type: string
  action_result: string
  action_external_id: string | null
  status: string
  error: string | null
  error_code: string | null
  duration_ms: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

// ── Row conversion ──

function rowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type as TriggerType,
    triggerCron: row.trigger_cron,
    triggerEvent: row.trigger_event as TriggerEvent | null,
    promptTemplate: row.prompt_template,
    actionType: row.action_type as ActionType,
    actionConfig: row.action_config,
    enabled: row.enabled === 1,
    catchUpEnabled: row.catch_up_enabled === 1,
    storePayloads: row.store_payloads === 1,
    deadlineWindowDays: row.deadline_window_days,
    nextRunAt: row.next_run_at,
    failureStreak: row.failure_streak,
    cooldownUntil: row.cooldown_until,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    runCount: row.run_count,
    duplicateSkipCount: row.duplicate_skip_count,
    lastDuplicateAt: row.last_duplicate_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToAutomationRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    domainId: row.domain_id,
    triggerType: row.trigger_type as TriggerType,
    triggerEvent: row.trigger_event as TriggerEvent | null,
    triggerData: row.trigger_data,
    dedupeKey: row.dedupe_key,
    promptHash: row.prompt_hash,
    promptRendered: row.prompt_rendered,
    responseHash: row.response_hash,
    llmResponse: row.llm_response,
    actionType: row.action_type as ActionType,
    actionResult: row.action_result,
    actionExternalId: row.action_external_id,
    status: row.status as RunStatus,
    error: row.error,
    errorCode: row.error_code as AutomationErrorCode | null,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

// ── Repository ──

export class AutomationRepository {
  constructor(private db: Database.Database) {}

  // ── CRUD ──

  create(input: CreateAutomationInput): Result<Automation, DomainOSError> {
    const parsed = CreateAutomationInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const data = parsed.data
    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO automations (id, domain_id, name, description, trigger_type, trigger_cron, trigger_event,
            prompt_template, action_type, action_config, enabled, catch_up_enabled, store_payloads,
            deadline_window_days, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          data.domainId,
          data.name,
          data.description,
          data.triggerType,
          data.triggerCron ?? null,
          data.triggerEvent ?? null,
          data.promptTemplate,
          data.actionType,
          data.actionConfig,
          data.enabled ? 1 : 0,
          data.catchUpEnabled ? 1 : 0,
          data.storePayloads ? 1 : 0,
          data.deadlineWindowDays ?? null,
          now,
          now,
        )

      return Ok({
        id,
        domainId: data.domainId,
        name: data.name,
        description: data.description,
        triggerType: data.triggerType,
        triggerCron: data.triggerCron ?? null,
        triggerEvent: data.triggerEvent ?? null,
        promptTemplate: data.promptTemplate,
        actionType: data.actionType,
        actionConfig: data.actionConfig,
        enabled: data.enabled,
        catchUpEnabled: data.catchUpEnabled,
        storePayloads: data.storePayloads,
        deadlineWindowDays: data.deadlineWindowDays ?? null,
        nextRunAt: null,
        failureStreak: 0,
        cooldownUntil: null,
        lastRunAt: null,
        lastError: null,
        runCount: 0,
        duplicateSkipCount: 0,
        lastDuplicateAt: null,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<Automation, DomainOSError> {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
      | AutomationRow
      | undefined

    if (!row) return Err(DomainOSError.notFound('Automation', id))
    return Ok(rowToAutomation(row))
  }

  getByDomain(domainId: string): Result<Automation[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM automations WHERE domain_id = ? ORDER BY created_at DESC')
        .all(domainId) as AutomationRow[]
      return Ok(rows.map(rowToAutomation))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  update(id: string, input: UpdateAutomationInput): Result<Automation, DomainOSError> {
    const parsed = UpdateAutomationInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    const updated: Automation = {
      ...existing.value,
      ...parsed.data,
      // Preserve fields that UpdateAutomationInput cannot set
      id: existing.value.id,
      domainId: existing.value.domainId,
      nextRunAt: existing.value.nextRunAt,
      failureStreak: existing.value.failureStreak,
      cooldownUntil: existing.value.cooldownUntil,
      lastRunAt: existing.value.lastRunAt,
      lastError: existing.value.lastError,
      runCount: existing.value.runCount,
      duplicateSkipCount: existing.value.duplicateSkipCount,
      lastDuplicateAt: existing.value.lastDuplicateAt,
      createdAt: existing.value.createdAt,
      updatedAt: now,
    }

    try {
      this.db
        .prepare(
          `UPDATE automations SET name = ?, description = ?, trigger_type = ?, trigger_cron = ?,
            trigger_event = ?, prompt_template = ?, action_type = ?, action_config = ?,
            enabled = ?, catch_up_enabled = ?, store_payloads = ?, deadline_window_days = ?,
            updated_at = ? WHERE id = ?`,
        )
        .run(
          updated.name,
          updated.description,
          updated.triggerType,
          updated.triggerCron,
          updated.triggerEvent,
          updated.promptTemplate,
          updated.actionType,
          updated.actionConfig,
          updated.enabled ? 1 : 0,
          updated.catchUpEnabled ? 1 : 0,
          updated.storePayloads ? 1 : 0,
          updated.deadlineWindowDays,
          now,
          id,
        )

      return Ok(updated)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  delete(id: string): Result<void, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing as unknown as Result<void, DomainOSError>

    try {
      this.db.prepare('DELETE FROM automations WHERE id = ?').run(id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  toggle(id: string): Result<Automation, DomainOSError> {
    const existing = this.getById(id)
    if (!existing.ok) return existing

    const now = new Date().toISOString()
    const newEnabled = !existing.value.enabled

    try {
      if (newEnabled) {
        // Enabling: flip enabled and reset cooldown
        this.db
          .prepare('UPDATE automations SET enabled = 1, cooldown_until = NULL, updated_at = ? WHERE id = ?')
          .run(now, id)
      } else {
        this.db
          .prepare('UPDATE automations SET enabled = 0, updated_at = ? WHERE id = ?')
          .run(now, id)
      }

      return Ok({
        ...existing.value,
        enabled: newEnabled,
        cooldownUntil: newEnabled ? null : existing.value.cooldownUntil,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Engine queries ──

  getEnabledByEvent(event: string): Result<Automation[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM automations WHERE enabled = 1 AND trigger_type = 'event' AND trigger_event = ?`,
        )
        .all(event) as AutomationRow[]
      return Ok(rows.map(rowToAutomation))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getScheduledEnabled(): Result<Automation[], DomainOSError> {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM automations WHERE enabled = 1 AND trigger_type = 'schedule'`,
        )
        .all() as AutomationRow[]
      return Ok(rows.map(rowToAutomation))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Run operations ──

  tryInsertRun(run: {
    automationId: string
    domainId: string
    triggerType: TriggerType
    triggerEvent: TriggerEvent | null
    triggerData: string | null
    dedupeKey: string | null
    actionType: ActionType
  }): Result<AutomationRun, 'duplicate'> {
    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(
          `INSERT INTO automation_runs (id, automation_id, domain_id, trigger_type, trigger_event,
            trigger_data, dedupe_key, action_type, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          id,
          run.automationId,
          run.domainId,
          run.triggerType,
          run.triggerEvent,
          run.triggerData,
          run.dedupeKey,
          run.actionType,
          now,
          now,
        )

      return Ok({
        id,
        automationId: run.automationId,
        domainId: run.domainId,
        triggerType: run.triggerType,
        triggerEvent: run.triggerEvent,
        triggerData: run.triggerData,
        dedupeKey: run.dedupeKey,
        promptHash: null,
        promptRendered: null,
        responseHash: null,
        llmResponse: null,
        actionType: run.actionType,
        actionResult: '',
        actionExternalId: null,
        status: 'pending' as RunStatus,
        error: null,
        errorCode: null,
        durationMs: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      })
    } catch (e) {
      const err = e as Error & { code?: string }
      const msg = err.message ?? ''
      const code = err.code ?? ''
      // better-sqlite3: code = 'SQLITE_CONSTRAINT_UNIQUE', message = 'UNIQUE constraint failed: ...'
      if ((code.includes('SQLITE_CONSTRAINT') || msg.includes('UNIQUE constraint failed')) && msg.includes('dedupe_key')) {
        // Atomically increment duplicate_skip_count and set last_duplicate_at on parent
        const dupNow = new Date().toISOString()
        this.db
          .prepare(
            `UPDATE automations SET duplicate_skip_count = duplicate_skip_count + 1, last_duplicate_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(dupNow, dupNow, run.automationId)
        return Err('duplicate' as const)
      }
      throw e
    }
  }

  updateRunStatus(
    runId: string,
    updates: {
      status?: RunStatus
      startedAt?: string
      promptHash?: string
      promptRendered?: string
      responseHash?: string
      llmResponse?: string
      actionResult?: string
      actionExternalId?: string
      error?: string
      errorCode?: AutomationErrorCode
    },
  ): Result<void, DomainOSError> {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status) }
    if (updates.startedAt !== undefined) { sets.push('started_at = ?'); params.push(updates.startedAt) }
    if (updates.promptHash !== undefined) { sets.push('prompt_hash = ?'); params.push(updates.promptHash) }
    if (updates.promptRendered !== undefined) { sets.push('prompt_rendered = ?'); params.push(updates.promptRendered) }
    if (updates.responseHash !== undefined) { sets.push('response_hash = ?'); params.push(updates.responseHash) }
    if (updates.llmResponse !== undefined) { sets.push('llm_response = ?'); params.push(updates.llmResponse) }
    if (updates.actionResult !== undefined) { sets.push('action_result = ?'); params.push(updates.actionResult) }
    if (updates.actionExternalId !== undefined) { sets.push('action_external_id = ?'); params.push(updates.actionExternalId) }
    if (updates.error !== undefined) { sets.push('error = ?'); params.push(updates.error) }
    if (updates.errorCode !== undefined) { sets.push('error_code = ?'); params.push(updates.errorCode) }

    params.push(runId)

    try {
      this.db.prepare(`UPDATE automation_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  finalizeRun(
    runId: string,
    outcome: {
      status: 'success' | 'failed' | 'skipped'
      completedAt: string
      durationMs: number | null
      error?: string | null
      errorCode?: AutomationErrorCode | null
      actionResult?: string
      actionExternalId?: string | null
      nextRunAt?: string | null
    },
  ): Result<void, DomainOSError> {
    const now = new Date().toISOString()

    try {
      this.db.transaction(() => {
        // Update the run row
        this.db
          .prepare(
            `UPDATE automation_runs SET status = ?, completed_at = ?, duration_ms = ?,
              error = ?, error_code = ?, action_result = COALESCE(?, action_result),
              action_external_id = COALESCE(?, action_external_id), updated_at = ?
             WHERE id = ?`,
          )
          .run(
            outcome.status,
            outcome.completedAt,
            outcome.durationMs,
            outcome.error ?? null,
            outcome.errorCode ?? null,
            outcome.actionResult ?? null,
            outcome.actionExternalId ?? null,
            now,
            runId,
          )

        // Get the automation_id from the run
        const run = this.db
          .prepare('SELECT automation_id FROM automation_runs WHERE id = ?')
          .get(runId) as { automation_id: string } | undefined

        if (!run) return

        // Update parent automation stats
        if (outcome.status === 'success') {
          this.db
            .prepare(
              `UPDATE automations SET run_count = run_count + 1, failure_streak = 0,
                last_run_at = ?, last_error = NULL, next_run_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(outcome.completedAt, outcome.nextRunAt ?? null, now, run.automation_id)
        } else if (outcome.status === 'failed') {
          this.db
            .prepare(
              `UPDATE automations SET run_count = run_count + 1, failure_streak = failure_streak + 1,
                last_run_at = ?, last_error = ?, cooldown_until = ?, next_run_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              outcome.completedAt,
              outcome.error ?? null,
              // Cooldown: exponential backoff based on new failure_streak
              this.computeCooldown(run.automation_id),
              outcome.nextRunAt ?? null,
              now,
              run.automation_id,
            )
        } else {
          // skipped
          this.db
            .prepare(
              `UPDATE automations SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
            )
            .run(outcome.completedAt, outcome.nextRunAt ?? null, now, run.automation_id)
        }
      })()

      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  private computeCooldown(automationId: string): string | null {
    const row = this.db
      .prepare('SELECT failure_streak FROM automations WHERE id = ?')
      .get(automationId) as { failure_streak: number } | undefined

    if (!row) return null

    // New streak is current + 1 (the UPDATE hasn't run yet within the transaction,
    // but we read the pre-increment value; the UPDATE does failure_streak + 1)
    const streak = row.failure_streak + 1
    // Exponential backoff: 5min * 2^(streak-1), capped at 24h
    const backoffMs = Math.min(5 * 60_000 * Math.pow(2, streak - 1), 24 * 60 * 60_000)
    return new Date(Date.now() + backoffMs).toISOString()
  }

  // ── Run history ──

  getRunsByAutomation(automationId: string, limit = 50): Result<AutomationRun[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(automationId, limit) as AutomationRunRow[]
      return Ok(rows.map(rowToAutomationRun))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getRunsByDomain(domainId: string, limit = 50): Result<AutomationRun[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM automation_runs WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, limit) as AutomationRunRow[]
      return Ok(rows.map(rowToAutomationRun))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Failure management ──

  incrementFailureStreak(id: string): Result<number, DomainOSError> {
    const now = new Date().toISOString()
    try {
      this.db
        .prepare('UPDATE automations SET failure_streak = failure_streak + 1, updated_at = ? WHERE id = ?')
        .run(now, id)

      const row = this.db
        .prepare('SELECT failure_streak FROM automations WHERE id = ?')
        .get(id) as { failure_streak: number } | undefined

      if (!row) return Err(DomainOSError.notFound('Automation', id))
      return Ok(row.failure_streak)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  resetFailureStreak(id: string): Result<void, DomainOSError> {
    const now = new Date().toISOString()
    try {
      this.db
        .prepare('UPDATE automations SET failure_streak = 0, cooldown_until = NULL, updated_at = ? WHERE id = ?')
        .run(now, id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  disableAutomation(id: string): Result<void, DomainOSError> {
    const now = new Date().toISOString()
    try {
      this.db
        .prepare('UPDATE automations SET enabled = 0, updated_at = ? WHERE id = ?')
        .run(now, id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Cleanup ──

  cleanupStaleRuns(staleBeforeMs: number): Result<number, DomainOSError> {
    const cutoff = new Date(Date.now() - staleBeforeMs).toISOString()
    const now = new Date().toISOString()

    try {
      const result = this.db
        .prepare(
          `UPDATE automation_runs SET status = 'failed', error = 'Stale run cleanup', error_code = 'crash_recovery',
            completed_at = ?, updated_at = ?
           WHERE status IN ('pending', 'running') AND created_at < ?`,
        )
        .run(now, now, cutoff)
      return Ok(result.changes)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  retentionCleanup(retentionDays: number, perAutomation: number): Result<number, DomainOSError> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
    const now = new Date().toISOString()

    try {
      // CTE-based cleanup: delete runs older than retention AND beyond per-automation limit
      const result = this.db
        .prepare(
          `WITH ranked AS (
            SELECT id, automation_id, created_at,
              ROW_NUMBER() OVER (PARTITION BY automation_id ORDER BY created_at DESC) AS rn
            FROM automation_runs
          ),
          to_delete AS (
            SELECT id FROM ranked
            WHERE rn > ? AND created_at < ?
          )
          DELETE FROM automation_runs WHERE id IN (SELECT id FROM to_delete)`,
        )
        .run(perAutomation, cutoff)
      return Ok(result.changes)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
