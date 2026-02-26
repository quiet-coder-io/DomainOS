/**
 * Zod schemas and TypeScript types for the Mission system.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

// ── Status enums ──

export const MissionRunStatusSchema = z.enum([
  'pending',
  'running',
  'gated',
  'success',
  'failed',
  'cancelled',
])
export type MissionRunStatus = z.infer<typeof MissionRunStatusSchema>

export const MissionGateStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export type MissionGateStatus = z.infer<typeof MissionGateStatusSchema>

export const MissionActionStatusSchema = z.enum(['pending', 'success', 'failed', 'skipped'])
export type MissionActionStatus = z.infer<typeof MissionActionStatusSchema>

export const MissionActionTypeSchema = z.enum(['create_deadline', 'draft_email', 'notification'])
export type MissionActionType = z.infer<typeof MissionActionTypeSchema>

export const MissionOutputTypeSchema = z.enum(['alert', 'action', 'monitor', 'raw', 'loan_review_memo'])
export type MissionOutputType = z.infer<typeof MissionOutputTypeSchema>

export const ProviderNameSchema = z.enum(['anthropic', 'openai', 'ollama'])
export type MissionProviderName = z.infer<typeof ProviderNameSchema>

// ── Mission definition (parsed from definition_json) ──

export interface MissionDefinition {
  type: string
  description: string
  steps: string[]
  gates: Array<{
    id: string
    description: string
    triggeredWhen: string
  }>
  actions: Array<{
    id: string
    type: string
    description: string
  }>
  parameters: Record<string, {
    type: string
    default: unknown
    description: string
  }>
  scope?: 'single-domain' | 'cross-domain'
  parametersOrder?: string[]
  /** Human-readable methodology name (e.g. "CMBS Loan Review"). */
  methodology?: string
  /** Labels for what this mission produces (e.g. ["Attorney Memo", "Risk Heatmap"]). */
  outputLabels?: string[]
}

// ── Domain types ──

export interface Mission {
  id: string
  name: string
  version: number
  definition: MissionDefinition
  definitionHash: string
  seedSource: string
  seedVersion: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface MissionDomainAssoc {
  missionId: string
  domainId: string
  isEnabled: boolean
  createdAt: string
}

export interface MissionRun {
  id: string
  missionId: string
  domainId: string
  status: MissionRunStatus
  inputsJson: Record<string, unknown>
  missionDefinitionHash: string
  promptHash: string
  modelId: string
  provider: string
  contextJson: Record<string, unknown>
  requestId: string | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface MissionRunOutput {
  id: string
  runId: string
  outputType: MissionOutputType
  contentJson: Record<string, unknown>
  artifactId: string | null
  createdAt: string
}

export interface MissionRunGate {
  id: string
  runId: string
  gateId: string
  status: MissionGateStatus
  message: string
  decidedAt: string | null
  decidedBy: string
  createdAt: string
}

export interface MissionRunAction {
  id: string
  runId: string
  actionId: string
  type: MissionActionType
  status: MissionActionStatus
  resultJson: Record<string, unknown>
  error: string | null
  createdAt: string
  updatedAt: string
}

// ── Input schemas ──

export const CreateMissionRunInputSchema = z.object({
  missionId: z.string().min(1, 'Mission ID is required'),
  domainId: UUIDSchema,
  inputs: z.record(z.unknown()).default({}),
  requestId: z.string().min(1, 'Request ID is required'),
  missionDefinitionHash: z.string().min(1, 'Definition hash is required'),
  promptHash: z.string().min(1, 'Prompt hash is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  provider: z.string().min(1, 'Provider is required'),
})

export type CreateMissionRunInput = z.infer<typeof CreateMissionRunInputSchema>

export const GateDecisionInputSchema = z.object({
  runId: UUIDSchema,
  gateId: z.string().min(1, 'Gate ID is required'),
  approved: z.boolean(),
})

export type GateDecisionInput = z.infer<typeof GateDecisionInputSchema>

// ── Summary types (for IPC/UI) ──

export interface MissionSummary {
  id: string
  name: string
  version: number
  description: string
  isEnabled: boolean
  parameters: MissionDefinition['parameters']
  scope?: MissionDefinition['scope']
  parametersOrder?: MissionDefinition['parametersOrder']
  methodology?: MissionDefinition['methodology']
  outputLabels?: MissionDefinition['outputLabels']
}

export interface MissionRunSummary {
  id: string
  missionId: string
  domainId: string
  status: MissionRunStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  error: string | null
  createdAt: string
}

export interface MissionRunDetail {
  run: MissionRun
  outputs: MissionRunOutput[]
  gates: MissionRunGate[]
  actions: MissionRunAction[]
}

// ── Context snapshot (stored per run for auditability) ──

export interface MissionContextSnapshot {
  domainsRead: string[]
  kbDigests: Array<{
    domainId: string
    path: string
    modified: string
    chars: number
    contentHash: string
  }>
  healthSnapshotHash?: string
  overdueGTasks?: number
  missionType?: string
  inputsHash?: string
  contextHash?: string
  promptHash?: string
  systemPromptChars?: number
  userPromptChars?: number
}
