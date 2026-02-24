import { z } from 'zod'
import { UUIDSchema } from '../common/index.js'

export const TriggerTypeEnum = z.enum(['schedule', 'event', 'manual'])
export type TriggerType = z.infer<typeof TriggerTypeEnum>

export const TriggerEventEnum = z.enum(['intake_created', 'kb_changed', 'gap_flag_raised', 'deadline_approaching'])
export type TriggerEvent = z.infer<typeof TriggerEventEnum>

export const ActionTypeEnum = z.enum(['notification', 'create_gtask', 'draft_gmail'])
export type ActionType = z.infer<typeof ActionTypeEnum>

// Action config sub-schemas
export const NotificationConfigSchema = z.object({}).default({})
export const GTaskConfigSchema = z.object({
  taskListId: z.string().optional(),
}).default({})
export const GmailConfigSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().optional(),
}).default({})

export const CreateAutomationInputSchema = z.object({
  domainId: UUIDSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  triggerType: TriggerTypeEnum,
  triggerCron: z.string().nullable().optional(),
  triggerEvent: TriggerEventEnum.nullable().optional(),
  promptTemplate: z.string().min(1).max(20000),
  actionType: ActionTypeEnum,
  actionConfig: z.string().default('{}'),
  enabled: z.boolean().default(true),
  catchUpEnabled: z.boolean().default(false),
  storePayloads: z.boolean().default(false),
  deadlineWindowDays: z.number().int().min(1).max(60).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.triggerType === 'schedule' && !data.triggerCron) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerCron is required for schedule triggers', path: ['triggerCron'] })
  }
  if (data.triggerType === 'event' && !data.triggerEvent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerEvent is required for event triggers', path: ['triggerEvent'] })
  }
  if (data.triggerType !== 'schedule' && data.triggerCron) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerCron only allowed for schedule triggers', path: ['triggerCron'] })
  }
  if (data.triggerType !== 'event' && data.triggerEvent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerEvent only allowed for event triggers', path: ['triggerEvent'] })
  }
  if (data.triggerType !== 'schedule' && data.catchUpEnabled) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'catchUpEnabled only allowed for schedule triggers', path: ['catchUpEnabled'] })
  }
  if (data.triggerEvent !== 'deadline_approaching' && data.deadlineWindowDays != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'deadlineWindowDays only allowed for deadline_approaching triggers', path: ['deadlineWindowDays'] })
  }
})

export type CreateAutomationInput = z.input<typeof CreateAutomationInputSchema>

export const UpdateAutomationInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  triggerType: TriggerTypeEnum.optional(),
  triggerCron: z.string().nullable().optional(),
  triggerEvent: TriggerEventEnum.nullable().optional(),
  promptTemplate: z.string().min(1).max(20000).optional(),
  actionType: ActionTypeEnum.optional(),
  actionConfig: z.string().optional(),
  enabled: z.boolean().optional(),
  catchUpEnabled: z.boolean().optional(),
  storePayloads: z.boolean().optional(),
  deadlineWindowDays: z.number().int().min(1).max(60).nullable().optional(),
})

export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInputSchema>

export interface Automation {
  id: string
  domainId: string
  name: string
  description: string
  triggerType: TriggerType
  triggerCron: string | null
  triggerEvent: TriggerEvent | null
  promptTemplate: string
  actionType: ActionType
  actionConfig: string
  enabled: boolean
  catchUpEnabled: boolean
  storePayloads: boolean
  deadlineWindowDays: number | null
  nextRunAt: string | null
  failureStreak: number
  cooldownUntil: string | null
  lastRunAt: string | null
  lastError: string | null
  runCount: number
  duplicateSkipCount: number
  lastDuplicateAt: string | null
  createdAt: string
  updatedAt: string
}

export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export type AutomationErrorCode =
  | 'rate_limited'
  | 'cooldown_active'
  | 'automation_disabled'
  | 'missing_oauth_scope'
  | 'gtasks_not_connected'
  | 'invalid_action_config'
  | 'template_render_error'
  | 'provider_not_configured'
  | 'llm_error'
  | 'timeout'
  | 'action_execution_error'
  | 'crash_recovery'

export interface AutomationRun {
  id: string
  automationId: string
  domainId: string
  triggerType: TriggerType
  triggerEvent: TriggerEvent | null
  triggerData: string | null
  dedupeKey: string | null
  promptHash: string | null
  promptRendered: string | null
  responseHash: string | null
  llmResponse: string | null
  actionType: ActionType
  actionResult: string
  actionExternalId: string | null
  status: RunStatus
  error: string | null
  errorCode: AutomationErrorCode | null
  durationMs: number | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}
