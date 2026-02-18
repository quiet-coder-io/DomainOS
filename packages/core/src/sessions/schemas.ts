/**
 * Zod schemas for session lifecycle.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const SessionScopeSchema = z.enum(['quick', 'working', 'prep'])
export type SessionScope = z.infer<typeof SessionScopeSchema>

export const SessionStatusSchema = z.enum(['active', 'wrapped_up'])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const CreateSessionInputSchema = z.object({
  domainId: UUIDSchema,
  scope: SessionScopeSchema.default('working'),
  modelProvider: z.string().default(''),
  modelName: z.string().default(''),
})

export type CreateSessionInput = z.input<typeof CreateSessionInputSchema>

export const SessionSchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  scope: SessionScopeSchema,
  status: SessionStatusSchema,
  modelProvider: z.string(),
  modelName: z.string(),
  startedAt: TimestampSchema,
  endedAt: z.string().nullable(),
})

export type Session = z.infer<typeof SessionSchema>
