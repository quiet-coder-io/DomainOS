/**
 * Advisory system Zod schemas — artifact storage, per-type payloads, IPC contracts.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

// ── Advisory enums ──

export const AdvisoryTypeSchema = z.enum(['brainstorm', 'risk_assessment', 'scenario', 'strategic_review'])
export type AdvisoryType = z.infer<typeof AdvisoryTypeSchema>

export const AdvisoryModeSchema = z.enum(['brainstorm', 'challenge', 'review', 'scenario', 'general'])
export type AdvisoryMode = z.infer<typeof AdvisoryModeSchema>

export const AdvisoryStatusSchema = z.enum(['active', 'archived'])
export type AdvisoryStatus = z.infer<typeof AdvisoryStatusSchema>

export const PersistValueSchema = z.enum(['yes', 'no', 'archive'])
export type PersistValue = z.infer<typeof PersistValueSchema>

export const AdvisorySourceSchema = z.enum(['llm', 'user', 'import'])
export type AdvisorySource = z.infer<typeof AdvisorySourceSchema>

export const CURRENT_SCHEMA_VERSION = 1

// ── Per-type payload schemas (strict — unknown keys rejected) ──

// -- Brainstorm --
const BrainstormOptionSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000),
  pros: z.string().max(500).optional(),
  cons: z.string().max(500).optional(),
  leverage: z.string().max(500).optional(),
  optionality: z.string().max(500).optional(),
  risk: z.string().max(500).optional(),
  action: z.string().max(500).optional(),
}).strict()

export const BrainstormPayloadSchema = z.object({
  topic: z.string().min(1).max(1000),
  options: z.array(BrainstormOptionSchema).min(1).max(10),
  recommendation: z.string().max(2000),
  contrarian_view: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  assumptions: z.array(z.string().max(500)).max(10).optional(),
}).strict()

export type BrainstormPayload = z.infer<typeof BrainstormPayloadSchema>

// -- Risk Assessment --
const RiskItemSchema = z.object({
  category: z.string().max(200),
  description: z.string().max(2000),
  severity: z.string().max(200).optional(),
  likelihood: z.string().max(200).optional(),
  mitigation: z.string().max(2000).optional(),
  impact: z.string().max(2000).optional(),
}).strict()

export const RiskAssessmentPayloadSchema = z.object({
  summary: z.string().min(1).max(2000),
  risks: z.array(RiskItemSchema).min(1).max(20),
  trend: z.string().max(200).optional(),
  trendConfidence: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
}).strict()

export type RiskAssessmentPayload = z.infer<typeof RiskAssessmentPayloadSchema>

// -- Scenario --
const ScenarioItemSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(2000),
  probability: z.string().max(200).optional(),
  outcome: z.string().max(2000).optional(),
  timeline: z.string().max(200).optional(),
}).strict()

export const ScenarioPayloadSchema = z.object({
  variables: z.array(z.string().max(500)).min(1).max(10),
  scenarios: z.array(ScenarioItemSchema).min(1).max(10),
  triggers: z.array(z.string().max(500)).max(20).optional(),
  leading_indicators: z.array(z.string().max(500)).max(20).optional(),
  notes: z.string().max(2000).optional(),
}).strict()

export type ScenarioPayload = z.infer<typeof ScenarioPayloadSchema>

// -- Strategic Review --
export const StrategicReviewPayloadSchema = z.object({
  posture: z.string().min(1).max(1000),
  highest_leverage_action: z.string().min(1).max(1000),
  trajectory: z.string().max(1000).optional(),
  tensions: z.array(z.string().max(500)).max(10).optional(),
  assumptions_to_check: z.array(z.string().max(500)).max(10).optional(),
  notes: z.string().max(2000).optional(),
}).strict()

export type StrategicReviewPayload = z.infer<typeof StrategicReviewPayloadSchema>

// ── Payload schema map (for type-dispatched validation) ──

export const PAYLOAD_SCHEMAS: Record<AdvisoryType, z.ZodType> = {
  brainstorm: BrainstormPayloadSchema,
  risk_assessment: RiskAssessmentPayloadSchema,
  scenario: ScenarioPayloadSchema,
  strategic_review: StrategicReviewPayloadSchema,
}

// ── Advisory Artifact (DB entity) ──

export const AdvisoryArtifactSchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  sessionId: z.string().nullable(),
  type: AdvisoryTypeSchema,
  title: z.string(),
  llmTitle: z.string(),
  schemaVersion: z.number().int().min(1),
  content: z.string(),
  fingerprint: z.string(),
  source: AdvisorySourceSchema,
  sourceMessageId: z.string().nullable(),
  status: AdvisoryStatusSchema,
  archivedAt: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type AdvisoryArtifact = z.infer<typeof AdvisoryArtifactSchema>

// ── Create input ──

export const CreateAdvisoryArtifactInputSchema = z.object({
  domainId: UUIDSchema,
  sessionId: z.string().optional(),
  type: AdvisoryTypeSchema,
  title: z.string().min(4).max(120),
  schemaVersion: z.number().int().min(1).default(1),
  content: z.string(),
  fingerprint: z.string().default(''),
  source: AdvisorySourceSchema.default('llm'),
  sourceMessageId: z.string().optional(),
  status: AdvisoryStatusSchema.default('active'),
  archivedAt: z.string().optional(),
})

export type CreateAdvisoryArtifactInput = z.input<typeof CreateAdvisoryArtifactInputSchema>

// ── Advisory Draft Block (stored in message metadata for 1-click save) ──

export interface AdvisoryDraftBlock {
  fenceType: string
  rawJson: string
  normalizedControl: {
    schemaVersion: number
    type: string
    persist: string
    title: string
  }
  payload: Record<string, unknown>
  warnings?: Array<{ warning: string; detail: string; fenceType: string; domainId: string }>
  savedArtifactId?: string
}

// ── Parse result contract ──

export interface AdvisoryParseResult {
  classifiedMode: AdvisoryMode
  draftBlocks: AdvisoryDraftBlock[]
  persisted: Array<{
    artifactId: string
    type: AdvisoryType
    status: AdvisoryStatus
  }>
  rejects: Array<{ reason: string; detail?: string; fenceType: string; domainId: string; sizeBytes: number }>
  warnings: Array<{ warning: string; detail: string; fenceType: string; domainId: string }>
  systemNotes: string[]
}

// ── Save draft block IPC types ──

export interface SaveDraftBlockInput {
  messageId: string
  blockIndex: number
  domainId: string
  sessionId?: string
}

export type SaveDraftBlockResult =
  | { ok: true; artifactId: string; message: string; idempotent?: boolean }
  | { ok: false; message: string }

// ── Task extraction types ──

export interface ExtractedTask {
  title: string
  priority: 'high' | 'medium' | 'low'
  dueOffset?: number
  sourceField: string
}

export interface NeedsEditingTask {
  title: string
  reason: 'too_short' | 'too_long' | 'no_action_indicator'
  suggestion?: string
  sourceField: string
}

export interface TurnIntoTasksInput {
  artifactId: string
  domainId: string
}

export interface TurnIntoTasksOutput {
  tasks: ExtractedTask[]
  needsEditing: NeedsEditingTask[]
  artifactId: string
  artifactTitle: string
}
