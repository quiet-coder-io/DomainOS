/**
 * Mission runner — 10-step lifecycle orchestrator.
 *
 * Framework-agnostic: no Electron imports. All platform concerns
 * injected via MissionRunnerDeps.
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { Ok, Err } from '../common/result.js'
import { DomainOSError } from '../common/errors.js'
import type { Result } from '../common/result.js'
import { MissionRepository } from './repository.js'
import { MissionRunRepository } from './run-repository.js'
import { getOutputParser } from './output-parser.js'
import type { MissionRun, MissionRunGate, MissionContextSnapshot } from './schemas.js'

// ── Dependencies (injected from platform layer) ──

export interface MissionRunnerDeps {
  db: Database.Database
  streamLLM: (
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal,
  ) => Promise<string>
  createDeadline: (
    domainId: string,
    text: string,
    dueDate: string,
    priority: number,
  ) => Promise<Result<unknown, DomainOSError>>
  createGmailDraft: (to: string, subject: string, body: string) => Promise<string>
  loadDigests: (
    domains: Array<{ id: string; name: string; kbPath: string }>,
  ) => Promise<Array<{ domainId: string; domainName: string; content: string }>>
  loadGlobalOverdueGTasks: () => Promise<number>
  buildPrompt: (context: {
    health: unknown
    digests: Array<{ domainId: string; domainName: string; content: string }>
    currentDate: string
    globalOverdueGTasks: number
  }) => string
  computeHealth: (db: Database.Database) => Promise<Result<unknown, DomainOSError>>
  emitProgress: (runId: string, event: MissionProgressEvent) => void
  auditLog: (input: {
    domainId: string
    changeDescription: string
    eventType: string
    source: string
  }) => void
}

// ── Progress events ──

export type MissionProgressEvent = { requestId: string; runId: string } & (
  | { type: 'step_started'; step: string }
  | { type: 'step_completed'; step: string }
  | { type: 'llm_chunk'; chunk: string }
  | { type: 'gate_triggered'; gate: MissionRunGate }
  | { type: 'run_complete'; status: string }
  | { type: 'run_failed'; error: string }
)

// ── Runner ──

export class MissionRunner {
  private missionRepo: MissionRepository
  private runRepo: MissionRunRepository

  constructor(private deps: MissionRunnerDeps) {
    this.missionRepo = new MissionRepository(deps.db)
    this.runRepo = new MissionRunRepository(deps.db)
  }

  async start(
    missionId: string,
    domainId: string,
    inputs: Record<string, unknown>,
    modelId: string,
    provider: string,
    signal: AbortSignal,
  ): Promise<Result<MissionRun, DomainOSError>> {
    const emit = (event: Omit<MissionProgressEvent, 'requestId' | 'runId'>) => {
      // Will be filled once we have a run
    }

    // ── Step 1: Validate inputs ──
    const missionResult = this.missionRepo.getById(missionId)
    if (!missionResult.ok) return missionResult
    const mission = missionResult.value

    if (!mission.isEnabled) {
      return Err(DomainOSError.validation(`Mission ${missionId} is disabled`))
    }

    // Apply defaults from definition
    const mergedInputs = { ...inputs }
    for (const [key, param] of Object.entries(mission.definition.parameters)) {
      if (mergedInputs[key] === undefined) {
        mergedInputs[key] = param.default
      }
    }

    // ── Step 2: Check permissions ──
    const permResult = this.missionRepo.isDomainEnabled(missionId, domainId)
    if (!permResult.ok) return permResult
    if (!permResult.value) {
      return Err(DomainOSError.validation(`Mission ${missionId} is not enabled for domain ${domainId}`))
    }

    // ── Step 3: Assemble context ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let health: any
    let digests: Array<{ domainId: string; domainName: string; content: string }>
    let overdueGTasks: number

    try {
      const healthResult = await this.deps.computeHealth(this.deps.db)
      if (!healthResult.ok) return healthResult
      health = healthResult.value

      digests = await this.deps.loadDigests([]) // Will be filled from domain list
      overdueGTasks = await this.deps.loadGlobalOverdueGTasks()
    } catch (e) {
      return Err(DomainOSError.db(`Context assembly failed: ${(e as Error).message}`))
    }

    // ── Step 4: Build prompt ──
    const currentDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date())

    const systemPrompt = this.deps.buildPrompt({
      health,
      digests,
      currentDate,
      globalOverdueGTasks: overdueGTasks,
    })

    const promptHash = createHash('sha256').update(systemPrompt).digest('hex')

    // ── Create run record ──
    const requestId = mergedInputs._requestId as string || crypto.randomUUID()
    const runResult = this.runRepo.create({
      missionId,
      domainId,
      inputs: mergedInputs,
      requestId,
      missionDefinitionHash: mission.definitionHash,
      promptHash,
      modelId,
      provider,
    })
    if (!runResult.ok) return runResult
    let run = runResult.value

    // Now we have a runId, wire up progress emission
    const emitProgress = (event: { type: string; [key: string]: unknown }) => {
      this.deps.emitProgress(run.id, { ...event, requestId, runId: run.id } as MissionProgressEvent)
    }

    try {
      // Transition to running
      emitProgress({ type: 'step_started', step: 'running' })
      const runningResult = this.runRepo.updateStatus(run.id, 'running')
      if (!runningResult.ok) return runningResult
      run = runningResult.value

      // Store context snapshot
      const contextSnapshot: MissionContextSnapshot = {
        domainsRead: digests.map((d) => d.domainId),
        kbDigests: digests.map((d) => ({
          domainId: d.domainId,
          path: 'kb_digest.md',
          modified: new Date().toISOString(),
          chars: d.content.length,
          contentHash: createHash('sha256').update(d.content).digest('hex'),
        })),
        healthSnapshotHash: health.snapshotHash,
        overdueGTasks,
        promptChars: systemPrompt.length,
      }
      this.runRepo.updateContextJson(run.id, contextSnapshot as unknown as Record<string, unknown>)

      // Audit: run started
      this.deps.auditLog({
        domainId,
        changeDescription: `Mission run started: ${mission.name} (run ${run.id})`,
        eventType: 'mission_run_started',
        source: 'mission',
      })

      // ── Step 5: Execute LLM (streaming) ──
      emitProgress({ type: 'step_started', step: 'llm' })
      const userMessage = 'Analyze this portfolio and produce briefing blocks.'
      let fullResponse = ''

      try {
        fullResponse = await this.deps.streamLLM(
          systemPrompt,
          userMessage,
          (chunk) => {
            emitProgress({ type: 'llm_chunk', chunk })
          },
          signal,
        )
      } catch (e) {
        if (signal.aborted) {
          const cancelResult = this.runRepo.updateStatus(run.id, 'cancelled')
          return cancelResult.ok ? Ok(cancelResult.value) : cancelResult
        }
        throw e
      }

      if (signal.aborted) {
        const cancelResult = this.runRepo.updateStatus(run.id, 'cancelled')
        return cancelResult.ok ? Ok(cancelResult.value) : cancelResult
      }
      emitProgress({ type: 'step_completed', step: 'llm' })

      // ── Step 6: Parse outputs ──
      emitProgress({ type: 'step_started', step: 'parse' })
      const parser = getOutputParser(missionId)
      const parseResult = parser
        ? parser.parse(fullResponse)
        : { outputs: [], rawText: fullResponse, diagnostics: { skippedBlocks: 0, errors: [] } }
      emitProgress({ type: 'step_completed', step: 'parse' })

      // ── Step 7: Persist outputs ──
      emitProgress({ type: 'step_started', step: 'persist' })

      // Always persist raw first
      this.runRepo.addOutput(run.id, 'raw', { text: fullResponse, chars: fullResponse.length })

      // Then parsed items
      for (const output of parseResult.outputs) {
        this.runRepo.addOutput(run.id, output.type, output.data)
      }
      emitProgress({ type: 'step_completed', step: 'persist' })

      // ── Step 8: Evaluate gates ──
      emitProgress({ type: 'step_started', step: 'gates' })
      const createDeadlines = mergedInputs.createDeadlines === true
      const draftEmailTo = (mergedInputs.draftEmailTo as string) || ''
      const parsedActions = parseResult.outputs.filter((o) => o.type === 'action')
      const needsGate = (createDeadlines && parsedActions.length > 0) || draftEmailTo.length > 0

      if (needsGate) {
        // Create pending actions first
        if (createDeadlines && parsedActions.length > 0) {
          for (let i = 0; i < parsedActions.length; i++) {
            this.runRepo.addAction(run.id, `deadline-${i}`, 'create_deadline')
          }
        }
        if (draftEmailTo) {
          this.runRepo.addAction(run.id, 'draft-email', 'draft_email')
        }

        // Build gate message
        const parts: string[] = []
        if (createDeadlines && parsedActions.length > 0) {
          parts.push(`Create ${parsedActions.length} deadline(s)`)
        }
        if (draftEmailTo) {
          parts.push(`Draft email to ${draftEmailTo}`)
        }

        const gateResult = this.runRepo.createGate(
          run.id,
          'side-effects',
          `Approve: ${parts.join(', ')}`,
        )

        if (gateResult.ok) {
          const gatedResult = this.runRepo.updateStatus(run.id, 'gated')
          if (!gatedResult.ok) return gatedResult
          run = gatedResult.value

          // Audit: gate triggered
          this.deps.auditLog({
            domainId,
            changeDescription: `Mission gate triggered: ${parts.join(', ')} (run ${run.id})`,
            eventType: 'mission_gate_triggered',
            source: 'mission',
          })

          emitProgress({ type: 'gate_triggered', gate: gateResult.value })
          emitProgress({ type: 'step_completed', step: 'gates' })
          return Ok(run)
        }
      }
      emitProgress({ type: 'step_completed', step: 'gates' })

      // ── No gate needed: finalize directly ──
      return this.finalizeRun(run.id, domainId, mission.name)
    } catch (e) {
      if (signal.aborted) {
        this.runRepo.updateStatus(run.id, 'cancelled')
        return this.runRepo.getById(run.id)
      }
      const errMsg = e instanceof Error ? e.message : String(e)
      this.runRepo.updateStatus(run.id, 'failed', errMsg)
      emitProgress({ type: 'run_failed', error: errMsg })

      this.deps.auditLog({
        domainId,
        changeDescription: `Mission run failed: ${mission.name} — ${errMsg} (run ${run.id})`,
        eventType: 'mission_run_failed',
        source: 'mission',
      })

      return this.runRepo.getById(run.id)
    }
  }

  async resumeAfterGate(
    runId: string,
    gateId: string,
    approved: boolean,
  ): Promise<Result<MissionRun, DomainOSError>> {
    // Decide gate
    const gateResult = this.runRepo.decideGate({ runId, gateId, approved })
    if (!gateResult.ok) return gateResult

    const runResult = this.runRepo.getById(runId)
    if (!runResult.ok) return runResult
    const run = runResult.value

    // Audit: gate decided
    this.deps.auditLog({
      domainId: run.domainId,
      changeDescription: `Mission gate ${approved ? 'approved' : 'rejected'}: ${gateId} (run ${runId})`,
      eventType: 'mission_gate_decided',
      source: 'mission',
    })

    if (!approved) {
      // Gate rejected: skip all pending actions, finalize as success
      this.runRepo.skipAllActions(runId)
      return this.finalizeRun(runId, run.domainId, run.missionId)
    }

    // ── Step 9: Execute actions (approved) ──
    const actionsResult = this.runRepo.getActions(runId)
    if (!actionsResult.ok) return actionsResult

    const outputsResult = this.runRepo.getOutputs(runId)
    if (!outputsResult.ok) return outputsResult

    const parsedActions = outputsResult.value.filter((o) => o.outputType === 'action')

    for (const action of actionsResult.value) {
      if (action.status !== 'pending') continue

      try {
        if (action.type === 'create_deadline') {
          // Find corresponding parsed action
          const idx = parseInt(action.actionId.replace('deadline-', ''), 10)
          const parsedAction = parsedActions[idx]
          if (parsedAction) {
            const data = parsedAction.contentJson
            const result = await this.deps.createDeadline(
              run.domainId,
              data.text as string,
              data.deadline as string || new Date().toISOString().split('T')[0],
              data.priority as number || 4,
            )
            if (result.ok) {
              this.runRepo.updateAction(action.id, 'success', { created: true })
            } else {
              this.runRepo.updateAction(action.id, 'failed', {}, result.error.message)
            }
          } else {
            this.runRepo.updateAction(action.id, 'skipped', { reason: 'no matching parsed action' })
          }
        } else if (action.type === 'draft_email') {
          const inputs = run.inputsJson
          const to = inputs.draftEmailTo as string
          if (to) {
            // Assemble email from outputs
            const alerts = outputsResult.value.filter((o) => o.outputType === 'alert')
            const actions = outputsResult.value.filter((o) => o.outputType === 'action')
            const subject = `Portfolio Briefing — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            const body = this.buildEmailBody(alerts, actions)
            const draftId = await this.deps.createGmailDraft(to, subject, body)
            this.runRepo.updateAction(action.id, 'success', { draftId })
          } else {
            this.runRepo.updateAction(action.id, 'skipped', { reason: 'no recipient' })
          }
        }

        // Audit: action executed
        this.deps.auditLog({
          domainId: run.domainId,
          changeDescription: `Mission action executed: ${action.type} (${action.actionId}, run ${runId})`,
          eventType: 'mission_action_executed',
          source: 'mission',
        })
      } catch (e) {
        this.runRepo.updateAction(action.id, 'failed', {}, (e as Error).message)
      }
    }

    // ── Step 10: Finalize ──
    return this.finalizeRun(runId, run.domainId, run.missionId)
  }

  async cancel(runId: string): Promise<Result<MissionRun, DomainOSError>> {
    return this.runRepo.updateStatus(runId, 'cancelled')
  }

  // ── Private helpers ──

  private finalizeRun(
    runId: string,
    domainId: string,
    missionName: string,
  ): Result<MissionRun, DomainOSError> {
    const result = this.runRepo.updateStatus(runId, 'success')

    if (result.ok) {
      this.deps.auditLog({
        domainId,
        changeDescription: `Mission run completed: ${missionName} (run ${runId})`,
        eventType: 'mission_run_completed',
        source: 'mission',
      })

      this.deps.emitProgress(runId, {
        requestId: result.value.requestId ?? '',
        runId,
        type: 'run_complete',
        status: 'success',
      })
    }

    return result
  }

  private buildEmailBody(
    alerts: Array<{ contentJson: Record<string, unknown> }>,
    actions: Array<{ contentJson: Record<string, unknown> }>,
  ): string {
    const lines: string[] = ['Portfolio Briefing Summary', '']

    if (alerts.length > 0) {
      lines.push('ALERTS:')
      for (const alert of alerts) {
        const d = alert.contentJson
        lines.push(`  [${(d.severity as string || 'info').toUpperCase()}] ${d.domain}: ${d.text}`)
      }
      lines.push('')
    }

    if (actions.length > 0) {
      lines.push('RECOMMENDED ACTIONS:')
      for (const action of actions) {
        const d = action.contentJson
        lines.push(`  P${d.priority} | ${d.domain}: ${d.text}`)
        if (d.deadline && d.deadline !== 'none') lines.push(`       Due: ${d.deadline}`)
      }
      lines.push('')
    }

    lines.push('Generated by DomainOS Mission System')
    return lines.join('\n')
  }
}
