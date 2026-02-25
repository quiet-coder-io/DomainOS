/**
 * Zod schemas for skills — user-activated procedural expertise.
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from '../common/index.js'

export const SkillOutputFormatSchema = z.enum(['freeform', 'structured'])
export type SkillOutputFormat = z.infer<typeof SkillOutputFormatSchema>

export const CreateSkillInputSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Skill name is required')
      .transform((s) => s.trim()),
    description: z.string().default(''),
    content: z.string().min(1, 'Skill content is required'),
    outputFormat: SkillOutputFormatSchema.default('freeform'),
    outputSchema: z.string().nullable().optional(),
    toolHints: z
      .union([
        z.array(z.string()),
        z
          .string()
          .transform((s) =>
            s
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
      ])
      .default([]),
    isEnabled: z.boolean().default(true),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.outputFormat === 'structured') {
      if (!data.outputSchema || data.outputSchema.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'outputSchema is required when outputFormat is structured',
          path: ['outputSchema'],
        })
      } else {
        try {
          JSON.parse(data.outputSchema)
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'outputSchema must be valid JSON',
            path: ['outputSchema'],
          })
        }
      }
    } else {
      // freeform: outputSchema must be null/undefined
      if (data.outputSchema != null && data.outputSchema.trim().length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'outputSchema must be null for freeform output format',
          path: ['outputSchema'],
        })
      }
    }
  })

export type CreateSkillInput = z.input<typeof CreateSkillInputSchema>

export const UpdateSkillInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .transform((s) => s.trim())
      .optional(),
    description: z.string().optional(),
    content: z.string().min(1).optional(),
    outputFormat: SkillOutputFormatSchema.optional(),
    outputSchema: z.string().nullable().optional(),
    toolHints: z
      .union([
        z.array(z.string()),
        z
          .string()
          .transform((s) =>
            s
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
      ])
      .optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    // When outputFormat is explicitly set to 'structured', outputSchema must also be provided
    if (data.outputFormat === 'structured') {
      if (data.outputSchema === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'outputSchema must be provided when changing outputFormat to structured',
          path: ['outputSchema'],
        })
      } else if (data.outputSchema === null || data.outputSchema.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'outputSchema is required when outputFormat is structured',
          path: ['outputSchema'],
        })
      } else {
        try {
          JSON.parse(data.outputSchema)
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'outputSchema must be valid JSON',
            path: ['outputSchema'],
          })
        }
      }
    }
    // When outputFormat is explicitly set to 'freeform', outputSchema if present must be null/undefined
    if (data.outputFormat === 'freeform' && data.outputSchema != null && data.outputSchema.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'outputSchema must be null for freeform output format',
        path: ['outputSchema'],
      })
    }
  })

export type UpdateSkillInput = z.infer<typeof UpdateSkillInputSchema>

export const SkillSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  description: z.string(),
  content: z.string(),
  outputFormat: SkillOutputFormatSchema,
  outputSchema: z.string().nullable(),
  toolHints: z.array(z.string()),
  isEnabled: z.boolean(),
  sortOrder: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Skill = z.infer<typeof SkillSchema>
