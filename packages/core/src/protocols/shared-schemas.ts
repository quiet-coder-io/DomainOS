/**
 * Zod schemas for shared protocols (not tied to any domain).
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const SharedProtocolScopeSchema = z.enum(['all', 'chat', 'startup'])
export type SharedProtocolScope = z.infer<typeof SharedProtocolScopeSchema>

export const CreateSharedProtocolInputSchema = z.object({
  name: z.string().min(1, 'Protocol name is required'),
  content: z.string().min(1, 'Protocol content is required'),
  sortOrder: z.number().int().nonnegative().default(0),
  priority: z.number().int().nonnegative().default(0),
  isEnabled: z.boolean().default(true),
  scope: SharedProtocolScopeSchema.default('all'),
})

export type CreateSharedProtocolInput = z.input<typeof CreateSharedProtocolInputSchema>

export const UpdateSharedProtocolInputSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  priority: z.number().int().nonnegative().optional(),
  isEnabled: z.boolean().optional(),
  scope: SharedProtocolScopeSchema.optional(),
})

export type UpdateSharedProtocolInput = z.infer<typeof UpdateSharedProtocolInputSchema>

export const SharedProtocolSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  content: z.string(),
  sortOrder: z.number(),
  priority: z.number(),
  isEnabled: z.boolean(),
  scope: SharedProtocolScopeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type SharedProtocol = z.infer<typeof SharedProtocolSchema>
