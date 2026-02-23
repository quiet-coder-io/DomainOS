/**
 * Pure functions for deadline evaluation — no DB access, fully testable.
 */

import type { Deadline } from './schemas.js'

/** UTC YYYY-MM-DD. Single source of truth for "today". */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A deadline is overdue when its due_date is strictly before today and status is active. */
export function isOverdue(deadline: Deadline, today?: string): boolean {
  return deadline.status === 'active' && deadline.dueDate < (today ?? todayISO())
}

/** Positive = future, 0 = today, negative = overdue. */
export function daysUntilDue(deadline: Deadline, today?: string): number {
  const t = today ?? todayISO()
  const dueMs = new Date(deadline.dueDate + 'T00:00:00Z').getTime()
  const todayMs = new Date(t + 'T00:00:00Z').getTime()
  return Math.round((dueMs - todayMs) / 86_400_000)
}

/**
 * Severity weight for an overdue active deadline.
 * Only contributes if overdue AND active.
 * P1-2 → 4, P3-4 → 2, P5-7 → 1.
 */
export function deadlineSeverityWeight(deadline: Deadline, today?: string): number {
  if (!isOverdue(deadline, today)) return 0
  if (deadline.priority <= 2) return 4
  if (deadline.priority <= 4) return 2
  return 1
}

export type DueDateCategory = 'overdue' | 'today' | 'this-week' | 'upcoming' | 'future'

/** Categorize a deadline's due date relative to today. */
export function categorizeDueDate(deadline: Deadline, today?: string): DueDateCategory {
  const days = daysUntilDue(deadline, today)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 7) return 'this-week'
  if (days <= 30) return 'upcoming'
  return 'future'
}
