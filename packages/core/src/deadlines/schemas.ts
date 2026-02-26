/**
 * Zod schemas for deadline tracking.
 */

import { z } from 'zod'

// ── Status & Source enums ──

export const DeadlineStatusSchema = z.enum(['active', 'snoozed', 'completed', 'cancelled'])
export type DeadlineStatus = z.infer<typeof DeadlineStatusSchema>

export const DeadlineSourceSchema = z.enum(['manual', 'briefing', 'mission'])
export type DeadlineSource = z.infer<typeof DeadlineSourceSchema>

// ── Date format ──

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

// ── Input schema ──

export const CreateDeadlineInputSchema = z.object({
  domainId: z.string().uuid(),
  text: z.string().min(1, 'Deadline text is required'),
  dueDate: DateStringSchema,
  priority: z.number().int().min(1).max(7).default(4),
  source: DeadlineSourceSchema.default('manual'),
  sourceRef: z.string().default(''),
})

export type CreateDeadlineInput = z.input<typeof CreateDeadlineInputSchema>

// ── Full deadline type ──

export interface Deadline {
  id: string
  domainId: string
  text: string
  dueDate: string
  priority: number
  status: DeadlineStatus
  source: DeadlineSource
  sourceRef: string
  snoozedUntil: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}
