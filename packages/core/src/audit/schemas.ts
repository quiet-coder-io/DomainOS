/**
 * Zod schemas for audit log and decision tracking.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

// --- Audit Log ---

export const AuditEventTypeSchema = z.enum([
  'kb_write',
  'cross_domain_read',
  'decision_created',
  'session_start',
  'session_wrap',
])
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>

export const CreateAuditInputSchema = z.object({
  domainId: UUIDSchema,
  sessionId: z.string().optional(),
  agentName: z.string().default(''),
  filePath: z.string().default(''),
  changeDescription: z.string().min(1, 'Change description is required'),
  contentHash: z.string().default(''),
  eventType: AuditEventTypeSchema.default('kb_write'),
  source: z.string().default('agent'),
})

export type CreateAuditInput = z.input<typeof CreateAuditInputSchema>

export const AuditEntrySchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  sessionId: z.string().nullable(),
  agentName: z.string(),
  filePath: z.string(),
  changeDescription: z.string(),
  contentHash: z.string(),
  eventType: AuditEventTypeSchema,
  source: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type AuditEntry = z.infer<typeof AuditEntrySchema>

// --- Decisions ---

export const DecisionStatusSchema = z.enum(['active', 'superseded', 'rejected'])
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

export const CreateDecisionInputSchema = z.object({
  domainId: UUIDSchema,
  sessionId: z.string().optional(),
  decisionId: z.string().min(1, 'Decision ID is required'),
  decision: z.string().min(1, 'Decision text is required'),
  rationale: z.string().default(''),
  downside: z.string().default(''),
  revisitTrigger: z.string().default(''),
  linkedFiles: z.array(z.string()).default([]),
})

export type CreateDecisionInput = z.input<typeof CreateDecisionInputSchema>

export const DecisionSchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  sessionId: z.string().nullable(),
  decisionId: z.string(),
  decision: z.string(),
  rationale: z.string(),
  downside: z.string(),
  revisitTrigger: z.string(),
  status: DecisionStatusSchema,
  supersedesDecisionId: z.string().nullable(),
  linkedFiles: z.array(z.string()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Decision = z.infer<typeof DecisionSchema>
