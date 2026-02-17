import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const CreateProtocolInputSchema = z.object({
  domainId: UUIDSchema,
  name: z.string().min(1, 'Protocol name is required'),
  content: z.string().min(1, 'Protocol content is required'),
  sortOrder: z.number().int().nonnegative().default(0),
})

export type CreateProtocolInput = z.input<typeof CreateProtocolInputSchema>

export const UpdateProtocolInputSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

export type UpdateProtocolInput = z.infer<typeof UpdateProtocolInputSchema>

export const ProtocolSchema = z.object({
  id: UUIDSchema,
  domainId: UUIDSchema,
  name: z.string(),
  content: z.string(),
  sortOrder: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Protocol = z.infer<typeof ProtocolSchema>
