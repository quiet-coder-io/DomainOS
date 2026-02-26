/**
 * Mission runner — 10-step lifecycle orchestrator.
 *
 * Framework-agnostic: no Electron imports. All platform concerns
 * injected via MissionRunnerDeps.
 *
 * Extension points: optional hooks (buildContext, buildPrompts, shouldGate,
 * buildEmailBody, buildEmailSubject) allow mission-specific behavior
 * without modifying the runner. When absent, falls back to portfolio-briefing logic.
 */

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { Ok, Err } from '../common/result.js'
import { DomainOSError } from '../common/errors.js'
import type { Result } from '../common/result.js'
import { MissionRepository } from './repository.js'
import { MissionRunRepository } from './run-repository.js'
import { getOutputParser } from './output-parser.js'
import type { MissionParseResult } from './output-parser.js'
import type { MissionRun, MissionRunGate, MissionContextSnapshot } from './schemas.js'

// ── Context types for dep hooks ──

export interface MissionContext {
  [key: string]: unknown
}

export interface MissionContextSnapshotPartial {
  domainsRead?: string[]
  kbDigests?: MissionContextSnapshot['kbDigests']
  healthSnapshotHash?: string
  overdueGTasks?: number
  missionType?: string
  inputsHash?: string
  [key: string]: unknown
}

export interface GateEvaluation {
  needsGate: boolean
  actionIds: string[]
  message: string
  warnings?: Array<{ code: string; message: string }>
}

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

  // ── Optional hooks for mission-specific behavior ──

  /** Assemble mission-specific context + provenance snapshot. */
  buildContext?: (domainId: string, inputs: Record<string, unknown>) => Promise<{
    context: MissionContext
    snapshot: MissionContextSnapshotPartial
  }>

  /** Build system + user prompts from context + inputs. */
  buildPrompts?: (
    context: MissionContext,
    inputs: Record<string, unknown>,
  ) => { system: string; user: string }

  /** Mission-specific gate evaluation (includes input validation like email format). */
  shouldGate?: (
    inputs: Record<string, unknown>,
    parseResult: MissionParseResult,
  ) => GateEvaluation

  /** Email body from stored outputs. */
  buildEmailBody?: (
    outputs: Array<{ contentJson: Record<string, unknown>; outputType: string }>,
  ) => string

  /** Email subject from stored inputs + outputs (content-aware). */
  buildEmailSubject?: (
    inputs: Record<string, unknown>,
    outputs: Array<{ contentJson: Record<string, unknown>; outputType: string }>,
  ) => string
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
    let systemPrompt: string
    let userMessage: string
    let contextSnapshot: MissionContextSnapshot

    if (this.deps.buildContext && this.deps.buildPrompts) {
      // Mission-specific context + prompt building
      let missionContext: MissionContext
      let snapshotPartial: MissionContextSnapshotPartial

      try {
        const built = await this.deps.buildContext(domainId, mergedInputs)
        missionContext = built.context
        snapshotPartial = built.snapshot
      } catch (e) {
        return Err(DomainOSError.db(`Context assembly failed: ${(e as Error).message}`))
      }

      // ── Step 4: Build prompt ──
      const prompts = this.deps.buildPrompts(missionContext, mergedInputs)
      systemPrompt = prompts.system
      userMessage = prompts.user

      // Build provenance snapshot
      const promptHash = createHash('sha256').update(systemPrompt + '\n---\n' + userMessage).digest('hex')
      contextSnapshot = {
        domainsRead: snapshotPartial.domainsRead ?? [domainId],
        kbDigests: snapshotPartial.kbDigests ?? [],
        missionType: snapshotPartial.missionType ?? mission.definition.type,
        inputsHash: createHash('sha256').update(JSON.stringify(mergedInputs)).digest('hex'),
        promptHash,
        systemPromptChars: systemPrompt.length,
        userPromptChars: userMessage.length,
      }
      // Compute contextHash from the full snapshot
      contextSnapshot.contextHash = createHash('sha256')
        .update(JSON.stringify(contextSnapshot))
        .digest('hex')
    } else {
      // Portfolio-briefing fallback (current behavior)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let health: any
      let digests: Array<{ domainId: string; domainName: string; content: string }>
      let overdueGTasks: number

      try {
        const healthResult = await this.deps.computeHealth(this.deps.db)
        if (!healthResult.ok) return healthResult
        health = healthResult.value

        digests = await this.deps.loadDigests([])
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

      systemPrompt = this.deps.buildPrompt({
        health,
        digests,
        currentDate,
        globalOverdueGTasks: overdueGTasks,
      })
      userMessage = 'Analyze this portfolio and produce briefing blocks.'

      contextSnapshot = {
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
        systemPromptChars: systemPrompt.length,
        userPromptChars: userMessage.length,
      }
    }

    const promptHash = createHash('sha256').update(systemPrompt + '\n---\n' + userMessage).digest('hex')

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

      if (this.deps.shouldGate) {
        // Mission-specific gate evaluation
        const gateEval = this.deps.shouldGate(mergedInputs, parseResult)

        // Store warnings in context if present
        if (gateEval.warnings && gateEval.warnings.length > 0) {
          const currentCtx = contextSnapshot as unknown as Record<string, unknown>
          currentCtx.warnings = gateEval.warnings
          this.runRepo.updateContextJson(run.id, currentCtx)
        }

        if (gateEval.needsGate) {
          // Validate actionIds against mission definition
          for (const actionId of gateEval.actionIds) {
            const definedAction = mission.definition.actions.find((a) => a.id === actionId)
            if (!definedAction) {
              const errMsg = `Gate references unknown actionId "${actionId}" not in mission definition`
              this.runRepo.updateStatus(run.id, 'failed', errMsg)
              emitProgress({ type: 'run_failed', error: errMsg })
              return this.runRepo.getById(run.id)
            }
            // Create pending action
            this.runRepo.addAction(run.id, actionId, definedAction.type as 'create_deadline' | 'draft_email' | 'notification')
          }

          const gateResult = this.runRepo.createGate(run.id, 'side-effects', gateEval.message)
          if (gateResult.ok) {
            const gatedResult = this.runRepo.updateStatus(run.id, 'gated')
            if (!gatedResult.ok) return gatedResult
            run = gatedResult.value

            this.deps.auditLog({
              domainId,
              changeDescription: `Mission gate triggered: ${gateEval.message} (run ${run.id})`,
              eventType: 'mission_gate_triggered',
              source: 'mission',
            })

            emitProgress({ type: 'gate_triggered', gate: gateResult.value })
            emitProgress({ type: 'step_completed', step: 'gates' })
            return Ok(run)
          }
        }
      } else {
        // Portfolio-briefing fallback (current behavior)
        const createDeadlines = mergedInputs.createDeadlines === true
        const draftEmailTo = (mergedInputs.draftEmailTo as string) || ''
        const parsedActions = parseResult.outputs.filter((o) => o.type === 'action')
        const needsGate = (createDeadlines && parsedActions.length > 0) || draftEmailTo.length > 0

        if (needsGate) {
          if (createDeadlines && parsedActions.length > 0) {
            for (let i = 0; i < parsedActions.length; i++) {
              this.runRepo.addAction(run.id, `deadline-${i}`, 'create_deadline')
            }
          }
          if (draftEmailTo) {
            this.runRepo.addAction(run.id, 'draft-email', 'draft_email')
          }

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

    const storedOutputs = outputsResult.value
    const parsedActions = storedOutputs.filter((o) => o.outputType === 'action')

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
          const storedInputs = run.inputsJson
          const to = storedInputs.draftEmailTo as string
          if (to) {
            // Build email subject + body using hooks or fallback
            const subject = this.deps.buildEmailSubject
              ? this.deps.buildEmailSubject(storedInputs, storedOutputs)
              : `Portfolio Briefing — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

            const body = this.deps.buildEmailBody
              ? this.deps.buildEmailBody(storedOutputs)
              : this.buildEmailBody(
                  storedOutputs.filter((o) => o.outputType === 'alert'),
                  storedOutputs.filter((o) => o.outputType === 'action'),
                )

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
