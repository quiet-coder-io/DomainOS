import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const MAX_INTAKE_CONTENT_BYTES = 100 * 1024

export const ExtractionModeSchema = z.enum(['full', 'excerpt'])

export const IntakeStatusSchema = z.enum(['pending', 'classified', 'ingested', 'dismissed'])

export type IntakeStatus = z.infer<typeof IntakeStatusSchema>

export const IntakeSourceTypeSchema = z.enum(['web', 'gmail', 'gtasks', 'manual'])

export type IntakeSourceType = z.infer<typeof IntakeSourceTypeSchema>

export const CreateIntakeItemInputSchema = z.object({
  sourceUrl: z.string().default(''),
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  extractionMode: ExtractionModeSchema.default('full'),
  sourceType: IntakeSourceTypeSchema.default('web'),
  externalId: z.string().default(''),
  metadata: z.record(z.unknown()).default({}),
})

export type CreateIntakeItemInput = z.input<typeof CreateIntakeItemInputSchema>

export const IntakeItemSchema = z.object({
  id: UUIDSchema,
  sourceUrl: z.string(),
  title: z.string(),
  content: z.string(),
  extractionMode: z.string(),
  contentSizeBytes: z.number(),
  suggestedDomainId: z.string().nullable(),
  confidence: z.number().nullable(),
  status: IntakeStatusSchema,
  sourceType: IntakeSourceTypeSchema,
  externalId: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: TimestampSchema,
  resolvedAt: z.string().nullable(),
})

export type IntakeItem = z.infer<typeof IntakeItemSchema>

export const ClassifyResultSchema = z.object({
  domainId: z.string(),
  domainName: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export type ClassifyResult = z.infer<typeof ClassifyResultSchema>
