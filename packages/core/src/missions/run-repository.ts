/**
 * Mission run lifecycle, outputs, gates, and actions.
 */

import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { Ok, Err } from '../common/result.js'
import { DomainOSError } from '../common/errors.js'
import type { Result } from '../common/result.js'
import {
  CreateMissionRunInputSchema,
  GateDecisionInputSchema,
  MissionOutputTypeSchema,
} from './schemas.js'
import type {
  MissionRun,
  MissionRunStatus,
  MissionRunOutput,
  MissionRunGate,
  MissionRunAction,
  MissionActionType,
  MissionActionStatus,
  MissionRunSummary,
  MissionRunDetail,
  CreateMissionRunInput,
  GateDecisionInput,
} from './schemas.js'

// ── Row types ──

interface MissionRunRow {
  id: string
  mission_id: string
  domain_id: string
  status: string
  inputs_json: string
  mission_definition_hash: string
  prompt_hash: string
  model_id: string
  provider: string
  context_json: string
  request_id: string | null
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  error: string | null
  created_at: string
  updated_at: string
}

interface OutputRow {
  id: string
  run_id: string
  output_type: string
  content_json: string
  artifact_id: string | null
  created_at: string
}

interface GateRow {
  id: string
  run_id: string
  gate_id: string
  status: string
  message: string
  decided_at: string | null
  decided_by: string
  created_at: string
}

interface ActionRow {
  id: string
  run_id: string
  action_id: string
  type: string
  status: string
  result_json: string
  error: string | null
  created_at: string
  updated_at: string
}

// ── Mappers ──

function rowToRun(row: MissionRunRow): MissionRun {
  return {
    id: row.id,
    missionId: row.mission_id,
    domainId: row.domain_id,
    status: row.status as MissionRunStatus,
    inputsJson: JSON.parse(row.inputs_json),
    missionDefinitionHash: row.mission_definition_hash,
    promptHash: row.prompt_hash,
    modelId: row.model_id,
    provider: row.provider,
    contextJson: JSON.parse(row.context_json),
    requestId: row.request_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToOutput(row: OutputRow): MissionRunOutput {
  return {
    id: row.id,
    runId: row.run_id,
    outputType: row.output_type as MissionRunOutput['outputType'],
    contentJson: JSON.parse(row.content_json),
    artifactId: row.artifact_id,
    createdAt: row.created_at,
  }
}

function rowToGate(row: GateRow): MissionRunGate {
  return {
    id: row.id,
    runId: row.run_id,
    gateId: row.gate_id,
    status: row.status as MissionRunGate['status'],
    message: row.message,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
  }
}

function rowToAction(row: ActionRow): MissionRunAction {
  return {
    id: row.id,
    runId: row.run_id,
    actionId: row.action_id,
    type: row.type as MissionRunAction['type'],
    status: row.status as MissionRunAction['status'],
    resultJson: JSON.parse(row.result_json),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function runToSummary(run: MissionRun): MissionRunSummary {
  return {
    id: run.id,
    missionId: run.missionId,
    domainId: run.domainId,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    error: run.error,
    createdAt: run.createdAt,
  }
}

// ── Valid state transitions ──

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(['running', 'cancelled']),
  running: new Set(['gated', 'success', 'failed', 'cancelled']),
  gated: new Set(['success', 'cancelled']),
  // Terminal states: no-op on repeat (idempotent cancel)
  success: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

// ── Repository ──

export class MissionRunRepository {
  constructor(private db: Database.Database) {}

  // ── Run lifecycle ──

  create(input: unknown): Result<MissionRun, DomainOSError> {
    const parsed = CreateMissionRunInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const data = parsed.data

    // Guard: no existing active run globally
    try {
      const active = this.db
        .prepare(`SELECT id FROM mission_runs WHERE status IN ('pending','running','gated') LIMIT 1`)
        .get() as { id: string } | undefined
      if (active) {
        return Err(DomainOSError.validation(`An active mission run already exists: ${active.id}`))
      }
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }

    const now = new Date().toISOString()
    const id = uuidv4()

    try {
      this.db
        .prepare(`
          INSERT INTO mission_runs (
            id, mission_id, domain_id, status, inputs_json,
            mission_definition_hash, prompt_hash, model_id, provider,
            context_json, request_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, '{}', ?, ?, ?)
        `)
        .run(
          id, data.missionId, data.domainId,
          JSON.stringify(data.inputs),
          data.missionDefinitionHash, data.promptHash,
          data.modelId, data.provider,
          data.requestId, now, now,
        )

      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getById(id: string): Result<MissionRun, DomainOSError> {
    try {
      const row = this.db
        .prepare('SELECT * FROM mission_runs WHERE id = ?')
        .get(id) as MissionRunRow | undefined
      if (!row) return Err(DomainOSError.notFound('MissionRun', id))
      return Ok(rowToRun(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  updateStatus(id: string, status: MissionRunStatus, error?: string): Result<MissionRun, DomainOSError> {
    const runResult = this.getById(id)
    if (!runResult.ok) return runResult

    const run = runResult.value
    const allowed = VALID_TRANSITIONS[run.status]

    // Terminal state → no-op (idempotent)
    if (allowed && allowed.size === 0 && (run.status === status)) {
      return Ok(run)
    }

    if (!allowed || !allowed.has(status)) {
      // Terminal state → silently no-op for cancel
      if (status === 'cancelled' && (run.status === 'success' || run.status === 'failed' || run.status === 'cancelled')) {
        return Ok(run)
      }
      return Err(DomainOSError.validation(`Invalid transition: ${run.status} → ${status}`))
    }

    const now = new Date().toISOString()
    const isTerminal = status === 'success' || status === 'failed' || status === 'cancelled'
    const isStarting = status === 'running'

    try {
      const startedAt = isStarting ? now : run.startedAt
      const endedAt = isTerminal ? now : run.endedAt
      const durationMs = isTerminal && run.startedAt
        ? new Date(now).getTime() - new Date(run.startedAt).getTime()
        : run.durationMs

      this.db
        .prepare(`
          UPDATE mission_runs SET
            status = ?, error = ?, started_at = ?, ended_at = ?,
            duration_ms = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(status, error ?? run.error, startedAt, endedAt, durationMs, now, id)

      // Cancel side effects: mark pending gates as rejected
      if (status === 'cancelled') {
        this.db
          .prepare(`
            UPDATE mission_run_gates SET status = 'rejected', decided_at = ?, decided_by = 'system'
            WHERE run_id = ? AND status = 'pending'
          `)
          .run(now, id)
      }

      return this.getById(id)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  updateContextJson(id: string, contextJson: Record<string, unknown>): Result<void, DomainOSError> {
    try {
      const now = new Date().toISOString()
      this.db
        .prepare('UPDATE mission_runs SET context_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(contextJson), now, id)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  listByDomain(domainId: string, limit = 20): Result<MissionRunSummary[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_runs WHERE domain_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(domainId, limit) as MissionRunRow[]
      return Ok(rows.map(rowToRun).map(runToSummary))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getActiveRun(): Result<MissionRun | null, DomainOSError> {
    try {
      const row = this.db
        .prepare(`SELECT * FROM mission_runs WHERE status IN ('pending','running','gated') LIMIT 1`)
        .get() as MissionRunRow | undefined
      return Ok(row ? rowToRun(row) : null)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getRunDetail(runId: string): Result<MissionRunDetail, DomainOSError> {
    const runResult = this.getById(runId)
    if (!runResult.ok) return runResult

    const outputsResult = this.getOutputs(runId)
    if (!outputsResult.ok) return outputsResult

    const gatesResult = this.getGates(runId)
    if (!gatesResult.ok) return gatesResult

    const actionsResult = this.getActions(runId)
    if (!actionsResult.ok) return actionsResult

    return Ok({
      run: runResult.value,
      outputs: outputsResult.value,
      gates: gatesResult.value,
      actions: actionsResult.value,
    })
  }

  // ── Outputs ──

  addOutput(
    runId: string,
    outputType: string,
    contentJson: Record<string, unknown>,
    artifactId?: string,
  ): Result<MissionRunOutput, DomainOSError> {
    // Validate output type via Zod
    const typeResult = MissionOutputTypeSchema.safeParse(outputType)
    if (!typeResult.success) {
      return Err(DomainOSError.validation(`Invalid output type: ${outputType}`))
    }

    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          INSERT INTO mission_run_outputs (id, run_id, output_type, content_json, artifact_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(id, runId, outputType, JSON.stringify(contentJson), artifactId ?? null, now)

      return Ok({
        id,
        runId,
        outputType: typeResult.data,
        contentJson,
        artifactId: artifactId ?? null,
        createdAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getOutputs(runId: string): Result<MissionRunOutput[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_run_outputs WHERE run_id = ? ORDER BY created_at')
        .all(runId) as OutputRow[]
      return Ok(rows.map(rowToOutput))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Gates ──

  createGate(runId: string, gateId: string, message: string): Result<MissionRunGate, DomainOSError> {
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          INSERT INTO mission_run_gates (id, run_id, gate_id, status, message, created_at)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `)
        .run(id, runId, gateId, message, now)

      return Ok({
        id,
        runId,
        gateId,
        status: 'pending',
        message,
        decidedAt: null,
        decidedBy: 'user',
        createdAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  decideGate(input: unknown): Result<MissionRunGate, DomainOSError> {
    const parsed = GateDecisionInputSchema.safeParse(input)
    if (!parsed.success) {
      return Err(DomainOSError.validation(parsed.error.issues.map((i) => i.message).join('; ')))
    }

    const { runId, gateId, approved } = parsed.data

    // Resume validation: run must be gated, gate must be pending
    const runResult = this.getById(runId)
    if (!runResult.ok) return runResult
    if (runResult.value.status !== 'gated') {
      return Err(DomainOSError.validation(`Run ${runId} is not in gated status (current: ${runResult.value.status})`))
    }

    try {
      const gateRow = this.db
        .prepare('SELECT * FROM mission_run_gates WHERE run_id = ? AND gate_id = ?')
        .get(runId, gateId) as GateRow | undefined
      if (!gateRow) return Err(DomainOSError.notFound('MissionRunGate', gateId))
      if (gateRow.status !== 'pending') {
        return Err(DomainOSError.validation(`Gate ${gateId} already decided: ${gateRow.status}`))
      }

      const now = new Date().toISOString()
      const newStatus = approved ? 'approved' : 'rejected'

      this.db
        .prepare('UPDATE mission_run_gates SET status = ?, decided_at = ?, decided_by = ? WHERE run_id = ? AND gate_id = ?')
        .run(newStatus, now, 'user', runId, gateId)

      return Ok({
        ...rowToGate(gateRow),
        status: newStatus,
        decidedAt: now,
        decidedBy: 'user',
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getPendingGates(runId: string): Result<MissionRunGate[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_run_gates WHERE run_id = ? AND status = ?')
        .all(runId, 'pending') as GateRow[]
      return Ok(rows.map(rowToGate))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getGates(runId: string): Result<MissionRunGate[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_run_gates WHERE run_id = ? ORDER BY created_at')
        .all(runId) as GateRow[]
      return Ok(rows.map(rowToGate))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  // ── Actions ──

  addAction(runId: string, actionId: string, type: MissionActionType): Result<MissionRunAction, DomainOSError> {
    const id = uuidv4()
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          INSERT INTO mission_run_actions (id, run_id, action_id, type, status, result_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?)
        `)
        .run(id, runId, actionId, type, now, now)

      return Ok({
        id,
        runId,
        actionId,
        type,
        status: 'pending',
        resultJson: {},
        error: null,
        createdAt: now,
        updatedAt: now,
      })
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  updateAction(
    id: string,
    status: MissionActionStatus,
    resultJson?: Record<string, unknown>,
    error?: string,
  ): Result<MissionRunAction, DomainOSError> {
    const now = new Date().toISOString()

    try {
      this.db
        .prepare(`
          UPDATE mission_run_actions SET status = ?, result_json = ?, error = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(status, JSON.stringify(resultJson ?? {}), error ?? null, now, id)

      const row = this.db
        .prepare('SELECT * FROM mission_run_actions WHERE id = ?')
        .get(id) as ActionRow | undefined
      if (!row) return Err(DomainOSError.notFound('MissionRunAction', id))
      return Ok(rowToAction(row))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  getActions(runId: string): Result<MissionRunAction[], DomainOSError> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM mission_run_actions WHERE run_id = ? ORDER BY created_at')
        .all(runId) as ActionRow[]
      return Ok(rows.map(rowToAction))
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }

  skipAllActions(runId: string): Result<void, DomainOSError> {
    const now = new Date().toISOString()
    try {
      this.db
        .prepare(`UPDATE mission_run_actions SET status = 'skipped', updated_at = ? WHERE run_id = ? AND status = 'pending'`)
        .run(now, runId)
      return Ok(undefined)
    } catch (e) {
      return Err(DomainOSError.db((e as Error).message))
    }
  }
}
