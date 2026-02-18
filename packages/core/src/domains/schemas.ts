import { z } from 'zod'
import { UUIDSchema, TimestampSchema, FilePathSchema } from '../common/index.js'

export const CreateDomainInputSchema = z.object({
  name: z.string().min(1, 'Domain name is required'),
  description: z.string().default(''),
  kbPath: FilePathSchema,
  identity: z.string().default(''),
  escalationTriggers: z.string().default(''),
})

export type CreateDomainInput = z.input<typeof CreateDomainInputSchema>

export const UpdateDomainInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  kbPath: FilePathSchema.optional(),
  identity: z.string().optional(),
  escalationTriggers: z.string().optional(),
})

export type UpdateDomainInput = z.infer<typeof UpdateDomainInputSchema>

export const DomainSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  description: z.string(),
  kbPath: z.string(),
  identity: z.string(),
  escalationTriggers: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Domain = z.infer<typeof DomainSchema>
