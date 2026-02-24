/**
 * Core automation engine — scheduler, event listener, execution pipeline.
 * Main-process only. No renderer computation.
 */

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import {
  AutomationRepository,
  matchesCron,
  lastCronMatch,
  generateDedupeKey,
  renderPromptTemplate,
} from '@domain-os/core'
import type { Automation, AutomationErrorCode, LLMProvider } from '@domain-os/core'
import { onAutomationEvent, offAutomationEvent } from './automation-events'
import type { AutomationEvent, AutomationEventHandler } from './automation-events'
import { executeAction } from './automation-actions'
import type { ActionDeps } from './automation-actions'

// ── Constants ──

const CRON_INTERVAL_MS = 60_000
const STALE_PENDING_MS = 600_000   // 10 min
const STALE_RUNNING_MS = 1_200_000 // 20 min
const RETENTION_DAYS = 90
const RETENTION_PER_AUTOMATION = 200
const RETENTION_INTERVAL_MS = 86_400_000 // 24h
const MAX_CONCURRENT_LLM = 3
const MAX_FAILURE_STREAK = 5

// Rate limits (in-memory)
const RATE_PER_AUTOMATION_PER_MIN = 1
const RATE_PER_DOMAIN_PER_HOUR = 10
const RATE_GLOBAL_PER_HOUR = 30

// Cooldown backoff (ms)
const COOLDOWN_RATE_LIMIT = 5 * 60_000
const COOLDOWN_BACKOFF_BASE = [60_000, 300_000, 900_000, 3_600_000]

// Error codes exempt from failure streak
const STREAK_EXEMPT_CODES = new Set<string>([
  'missing_oauth_scope', 'rate_limited', 'gtasks_not_connected',
  'invalid_action_config', 'crash_recovery',
])

// ── Engine config ──

export interface AutomationEngineConfig {
  db: Database.Database
  mainWindow: BrowserWindow | null
  getProvider: (domainId: string) => Promise<LLMProvider | null>
  actionDeps: ActionDeps
}

// ── State ──

let repo: AutomationRepository
let config: AutomationEngineConfig
let cronInterval: ReturnType<typeof setInterval> | null = null
let retentionInterval: ReturnType<typeof setInterval> | null = null
let eventHandler: AutomationEventHandler | null = null
let running = false

// Double-fire guard: tracks last fired minute per automation
const lastMinuteKey = new Map<string, string>()

// Semaphore for concurrent LLM calls
let semaphoreCount = 0
const semaphoreQueue: Array<() => void> = []

// Rate limit counters (in-memory ring buffers)
const automationTimestamps = new Map<string, number[]>() // automationId → timestamps
const domainTimestamps = new Map<string, number[]>()     // domainId → timestamps
const globalTimestamps: number[] = []

// Cooldown backoff tracker
const failureCounts = new Map<string, number>() // automationId → consecutive provider failures

// ── Semaphore ──

function acquireSemaphore(): Promise<void> {
  if (semaphoreCount < MAX_CONCURRENT_LLM) {
    semaphoreCount++
    return Promise.resolve()
  }
  return new Promise(resolve => semaphoreQueue.push(() => { semaphoreCount++; resolve() }))
}

function releaseSemaphore(): void {
  semaphoreCount--
  const next = semaphoreQueue.shift()
  if (next) next()
}

// ── Rate limiting ──

function isRateLimited(automationId: string, domainId: string): string | null {
  const now = Date.now()
  const oneMin = now - 60_000
  const oneHour = now - 3_600_000

  // Per-automation: 1/min
  const ats = automationTimestamps.get(automationId) ?? []
  const recentAts = ats.filter(t => t > oneMin)
  if (recentAts.length >= RATE_PER_AUTOMATION_PER_MIN) return 'rate_limited'
  automationTimestamps.set(automationId, recentAts)

  // Per-domain: 10/hour
  const dts = domainTimestamps.get(domainId) ?? []
  const recentDts = dts.filter(t => t > oneHour)
  if (recentDts.length >= RATE_PER_DOMAIN_PER_HOUR) return 'rate_limited'
  domainTimestamps.set(domainId, recentDts)

  // Global: 30/hour
  while (globalTimestamps.length > 0 && globalTimestamps[0] < oneHour) globalTimestamps.shift()
  if (globalTimestamps.length >= RATE_GLOBAL_PER_HOUR) return 'rate_limited'

  return null
}

function recordRateUsage(automationId: string, domainId: string): void {
  const now = Date.now()
  const ats = automationTimestamps.get(automationId) ?? []
  ats.push(now)
  automationTimestamps.set(automationId, ats)

  const dts = domainTimestamps.get(domainId) ?? []
  dts.push(now)
  domainTimestamps.set(domainId, dts)

  globalTimestamps.push(now)
}

// ── Minute key ──

function currentMinuteKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Guard checks ──

function guardCheck(automation: Automation): AutomationErrorCode | null {
  if (!automation.enabled) return 'automation_disabled'

  // Cooldown
  if (automation.cooldownUntil) {
    const cooldownTime = new Date(automation.cooldownUntil).getTime()
    if (Date.now() < cooldownTime) return 'cooldown_active'
  }

  // Rate limit
  const rateLimited = isRateLimited(automation.id, automation.domainId)
  if (rateLimited) return 'rate_limited'

  return null
}

// ── Execution pipeline ──

async function executeAutomation(
  automation: Automation,
  triggerType: string,
  triggerEvent: string | null,
  triggerData: Record<string, unknown> | null,
  minuteKey: string,
  requestId?: string,
): Promise<void> {
  // 1. Guard checks
  const guardError = guardCheck(automation)
  if (guardError) {
    const now = new Date().toISOString()
    const guardRunResult = repo.tryInsertRun({
      automationId: automation.id,
      domainId: automation.domainId,
      triggerType: automation.triggerType,
      triggerEvent: automation.triggerEvent,
      triggerData: null,
      dedupeKey: null,
      actionType: automation.actionType,
    })
    if (guardRunResult.ok) {
      repo.finalizeRun(guardRunResult.value.id, {
        status: 'skipped',
        errorCode: guardError,
        error: guardError,
        completedAt: now,
        durationMs: null,
      })
    }

    if (guardError === 'rate_limited') {
      repo.update(automation.id, {})
      // Set cooldown for rate limit
      const cooldownUntil = new Date(Date.now() + COOLDOWN_RATE_LIMIT).toISOString()
      try {
        config.db.prepare('UPDATE automations SET cooldown_until = ?, updated_at = ? WHERE id = ?')
          .run(cooldownUntil, now, automation.id)
      } catch { /* best effort */ }
    }
    return
  }

  // 2. Generate dedupe key and INSERT run
  const dedupeKey = generateDedupeKey(automation.id, triggerType, {
    minuteKey,
    eventType: triggerEvent ?? undefined,
    eventData: triggerData ?? undefined,
    requestId,
  })

  const now = new Date().toISOString()

  // Privacy-aware trigger data
  let storedTriggerData: string | null = null
  if (triggerData) {
    if (automation.storePayloads) {
      storedTriggerData = JSON.stringify(triggerData).slice(0, 20000)
    } else {
      // Store only stable low-sensitivity fields
      const minimal: Record<string, unknown> = { entityId: triggerData.entityId, entityType: triggerData.entityType }
      storedTriggerData = JSON.stringify(minimal)
    }
  }

  const insertResult = repo.tryInsertRun({
    automationId: automation.id,
    domainId: automation.domainId,
    triggerType: automation.triggerType,
    triggerEvent: automation.triggerEvent,
    triggerData: storedTriggerData,
    dedupeKey,
    actionType: automation.actionType,
  })

  if (!insertResult.ok) {
    // Duplicate — just log
    console.debug(`[automation-engine] Dedupe: skipping duplicate run for ${automation.name}`)
    return
  }

  const runId = insertResult.value.id
  recordRateUsage(automation.id, automation.domainId)

  // 3. Render prompt
  const templateContext: Record<string, string> = {
    domain_name: automation.domainId,
    event_type: triggerEvent ?? triggerType,
    event_data: triggerData ? JSON.stringify(triggerData) : '',
    current_date: new Date().toLocaleDateString(),
  }

  let renderedPrompt: string
  try {
    renderedPrompt = renderPromptTemplate(automation.promptTemplate, templateContext)
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    repo.finalizeRun(runId, {
      status: 'failed', errorCode: 'template_render_error', error: errMsg,
      completedAt: new Date().toISOString(), durationMs: null,
    })
    return
  }

  const promptHash = createHash('sha256').update(renderedPrompt).digest('hex')
  repo.updateRunStatus(runId, {
    promptHash,
    promptRendered: automation.storePayloads ? renderedPrompt : undefined,
  })

  // 4. Acquire semaphore + mark running
  await acquireSemaphore()
  const startedAt = new Date().toISOString()
  repo.updateRunStatus(runId, { status: 'running', startedAt })

  let llmResponse: string | undefined
  let responseHash: string | undefined
  let actionResult = ''
  let actionExternalId: string | undefined
  let errorCode: AutomationErrorCode | undefined
  let error: string | undefined

  try {
    // 5. Call LLM
    const provider = await config.getProvider(automation.domainId)
    if (!provider) {
      errorCode = 'provider_not_configured'
      error = 'No LLM provider configured for domain'
      return
    }

    const result = await provider.chatComplete(
      [{ role: 'user', content: renderedPrompt }],
      `You are an automation assistant for domain "${automation.domainId}". Respond concisely.`,
    )

    if (!result.ok) {
      errorCode = 'llm_error'
      error = result.error.message
      return
    }

    llmResponse = result.value
    responseHash = createHash('sha256').update(llmResponse).digest('hex')

    repo.updateRunStatus(runId, {
      responseHash,
      llmResponse: automation.storePayloads ? llmResponse : undefined,
    })
  } catch (e) {
    errorCode = 'llm_error'
    error = e instanceof Error ? e.message : String(e)
    return
  } finally {
    releaseSemaphore()
  }

  // 6. Execute action (outside semaphore)
  if (llmResponse && !errorCode) {
    try {
      const result = await executeAction(automation, llmResponse, config.actionDeps)
      actionResult = result.result
      actionExternalId = result.externalId
      if (result.errorCode) {
        errorCode = result.errorCode as AutomationErrorCode
        error = result.result || result.errorCode
      }
    } catch (e) {
      errorCode = 'action_execution_error'
      error = e instanceof Error ? e.message : String(e)
    }
  }

  // 7. Finalize
  const completedAt = new Date().toISOString()
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const status = errorCode ? 'failed' : 'success'

  repo.finalizeRun(runId, {
    status,
    errorCode: errorCode ?? null,
    error: error ?? null,
    actionResult,
    actionExternalId: actionExternalId ?? null,
    completedAt,
    durationMs,
  })

  // Failure tracking
  if (status === 'failed' && errorCode && !STREAK_EXEMPT_CODES.has(errorCode)) {
    const streak = repo.incrementFailureStreak(automation.id)
    if (streak.ok && streak.value >= MAX_FAILURE_STREAK) {
      repo.disableAutomation(automation.id)
      config.mainWindow?.webContents.send('automation:notification', {
        automationId: automation.id,
        automationName: automation.name,
        domainId: automation.domainId,
        message: `Automation "${automation.name}" disabled due to ${streak.value} consecutive failures. Last error: ${error}`,
      })
    }

    // Exponential backoff
    if (errorCode === 'llm_error' || errorCode === 'timeout') {
      const count = (failureCounts.get(automation.id) ?? 0) + 1
      failureCounts.set(automation.id, count)
      const backoffMs = COOLDOWN_BACKOFF_BASE[Math.min(count - 1, COOLDOWN_BACKOFF_BASE.length - 1)]
      const cooldownUntil = new Date(Date.now() + backoffMs).toISOString()
      try {
        config.db.prepare('UPDATE automations SET cooldown_until = ?, updated_at = ? WHERE id = ?')
          .run(cooldownUntil, new Date().toISOString(), automation.id)
      } catch { /* best effort */ }
    }
  } else if (status === 'success') {
    repo.resetFailureStreak(automation.id)
    failureCounts.delete(automation.id)
  }

  // IPC notify renderer
  config.mainWindow?.webContents.send('automation:run-complete', {
    automationId: automation.id,
    runId,
    status,
    actionResult,
  })
}

// ── Cron scheduler tick ──

function cronTick(): void {
  if (!running) return

  const now = new Date()
  const mk = currentMinuteKey()

  const scheduleResult = repo.getScheduledEnabled()
  if (!scheduleResult.ok) return

  for (const automation of scheduleResult.value) {
    if (!automation.triggerCron) continue

    // Double-fire guard
    if (lastMinuteKey.get(automation.id) === mk) continue

    if (matchesCron(automation.triggerCron, now)) {
      lastMinuteKey.set(automation.id, mk)
      executeAutomation(automation, 'schedule', null, null, mk).catch(err => {
        console.error(`[automation-engine] Schedule execution error for ${automation.name}:`, err)
      })
    }
  }
}

// ── Event handler ──

function handleEvent(event: AutomationEvent): void {
  if (!running) return

  const mk = currentMinuteKey()

  const result = repo.getEnabledByEvent(event.type)
  if (!result.ok) return

  for (const automation of result.value) {
    // Match domain — empty domainId matches all (for intake before classification)
    if (event.domainId && automation.domainId !== event.domainId) continue

    executeAutomation(
      automation, 'event', event.type, event.data as unknown as Record<string, unknown>, mk,
    ).catch(err => {
      console.error(`[automation-engine] Event execution error for ${automation.name}:`, err)
    })
  }
}

// ── Startup jobs ──

function crashRecovery(): void {
  const now = new Date().toISOString()
  const pending = repo.cleanupStaleRuns(STALE_PENDING_MS)
  const runningStale = repo.cleanupStaleRuns(STALE_RUNNING_MS)
  if (pending.ok && pending.value > 0) {
    console.log(`[automation-engine] Crash recovery: marked ${pending.value} stale pending runs as failed`)
  }
  if (runningStale.ok && runningStale.value > 0) {
    console.log(`[automation-engine] Crash recovery: marked ${runningStale.value} stale running runs as failed`)
  }
}

function startupCatchUp(): void {
  const scheduleResult = repo.getScheduledEnabled()
  if (!scheduleResult.ok) return

  for (const automation of scheduleResult.value) {
    if (!automation.catchUpEnabled || !automation.triggerCron) continue

    const lastMatch = lastCronMatch(automation.triggerCron, new Date())
    if (!lastMatch) continue

    // If last_run_at is before the most recent match, fire once
    if (!automation.lastRunAt || new Date(automation.lastRunAt) < lastMatch) {
      const mk = currentMinuteKey()
      console.log(`[automation-engine] Catch-up: firing ${automation.name}`)
      executeAutomation(automation, 'schedule', null, null, mk).catch(err => {
        console.error(`[automation-engine] Catch-up error for ${automation.name}:`, err)
      })
    }
  }
}

function retentionCleanup(): void {
  const result = repo.retentionCleanup(RETENTION_DAYS, RETENTION_PER_AUTOMATION)
  if (result.ok && result.value > 0) {
    console.log(`[automation-engine] Retention cleanup: deleted ${result.value} old runs`)
  }
}

// ── Public API ──

export function startAutomationEngine(engineConfig: AutomationEngineConfig): void {
  if (running) return

  config = engineConfig
  repo = new AutomationRepository(config.db)
  running = true

  // Startup jobs
  crashRecovery()
  retentionCleanup()
  startupCatchUp()

  console.log('[automation-engine] rate_limit_state_reset=true')

  // Cron scheduler
  cronInterval = setInterval(cronTick, CRON_INTERVAL_MS)

  // Retention cleanup every 24h
  retentionInterval = setInterval(retentionCleanup, RETENTION_INTERVAL_MS)

  // Event listener
  eventHandler = handleEvent
  onAutomationEvent(eventHandler)

  console.log('[automation-engine] Started')
}

export function stopAutomationEngine(): void {
  running = false

  if (cronInterval) {
    clearInterval(cronInterval)
    cronInterval = null
  }

  if (retentionInterval) {
    clearInterval(retentionInterval)
    retentionInterval = null
  }

  if (eventHandler) {
    offAutomationEvent(eventHandler)
    eventHandler = null
  }

  // Clear in-memory state
  lastMinuteKey.clear()
  automationTimestamps.clear()
  domainTimestamps.clear()
  globalTimestamps.length = 0
  failureCounts.clear()
  semaphoreCount = 0
  semaphoreQueue.length = 0

  console.log('[automation-engine] Stopped')
}

/**
 * Trigger a manual run from the renderer.
 */
export function triggerManualRun(automationId: string, requestId: string): void {
  if (!running) return

  const result = repo.getById(automationId)
  if (!result.ok) return

  const mk = currentMinuteKey()
  executeAutomation(result.value, 'manual', null, null, mk, requestId).catch(err => {
    console.error(`[automation-engine] Manual execution error:`, err)
  })
}
