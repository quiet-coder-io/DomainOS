import { z } from 'zod'
import { UUIDSchema, TimestampSchema, FilePathSchema } from '../common/index.js'

export const CreateDomainInputSchema = z.object({
  name: z.string().min(1, 'Domain name is required'),
  description: z.string().default(''),
  kbPath: FilePathSchema,
})

export type CreateDomainInput = z.input<typeof CreateDomainInputSchema>

export const UpdateDomainInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  kbPath: FilePathSchema.optional(),
})

export type UpdateDomainInput = z.infer<typeof UpdateDomainInputSchema>

export const DomainSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  description: z.string(),
  kbPath: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Domain = z.infer<typeof DomainSchema>
