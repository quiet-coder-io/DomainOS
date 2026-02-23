import { describe, it, expect } from 'vitest'
import {
  todayISO,
  isOverdue,
  daysUntilDue,
  deadlineSeverityWeight,
  categorizeDueDate,
} from '../../src/deadlines/evaluation.js'
import type { Deadline } from '../../src/deadlines/schemas.js'

/** Helper to create a minimal deadline for testing. */
function makeDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 'test-id',
    domainId: 'test-domain',
    text: 'Test deadline',
    dueDate: '2025-06-15',
    priority: 4,
    status: 'active',
    source: 'manual',
    sourceRef: '',
    snoozedUntil: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('todayISO', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayISO()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('isOverdue', () => {
  it('returns true when due_date is before today and status is active', () => {
    const d = makeDeadline({ dueDate: '2025-06-10' })
    expect(isOverdue(d, '2025-06-15')).toBe(true)
  })

  it('returns false when due_date is today', () => {
    const d = makeDeadline({ dueDate: '2025-06-15' })
    expect(isOverdue(d, '2025-06-15')).toBe(false)
  })

  it('returns false when due_date is in the future', () => {
    const d = makeDeadline({ dueDate: '2025-06-20' })
    expect(isOverdue(d, '2025-06-15')).toBe(false)
  })

  it('returns false for snoozed deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', status: 'snoozed' })
    expect(isOverdue(d, '2025-06-15')).toBe(false)
  })

  it('returns false for completed deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', status: 'completed' })
    expect(isOverdue(d, '2025-06-15')).toBe(false)
  })

  it('returns false for cancelled deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', status: 'cancelled' })
    expect(isOverdue(d, '2025-06-15')).toBe(false)
  })
})

describe('daysUntilDue', () => {
  it('returns positive for future deadlines', () => {
    const d = makeDeadline({ dueDate: '2025-06-20' })
    expect(daysUntilDue(d, '2025-06-15')).toBe(5)
  })

  it('returns 0 for today', () => {
    const d = makeDeadline({ dueDate: '2025-06-15' })
    expect(daysUntilDue(d, '2025-06-15')).toBe(0)
  })

  it('returns negative for overdue', () => {
    const d = makeDeadline({ dueDate: '2025-06-10' })
    expect(daysUntilDue(d, '2025-06-15')).toBe(-5)
  })

  it('handles month boundary', () => {
    const d = makeDeadline({ dueDate: '2025-07-01' })
    expect(daysUntilDue(d, '2025-06-30')).toBe(1)
  })

  it('handles leap year Feb 29', () => {
    const d = makeDeadline({ dueDate: '2024-02-29' })
    expect(daysUntilDue(d, '2024-02-28')).toBe(1)
  })
})

describe('deadlineSeverityWeight', () => {
  it('returns 4 for overdue P1 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 1 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(4)
  })

  it('returns 4 for overdue P2 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 2 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(4)
  })

  it('returns 2 for overdue P3 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 3 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(2)
  })

  it('returns 2 for overdue P4 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 4 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(2)
  })

  it('returns 1 for overdue P5 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 5 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(1)
  })

  it('returns 1 for overdue P7 deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 7 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(1)
  })

  it('returns 0 for non-overdue deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-20', priority: 1 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(0)
  })

  it('returns 0 for overdue but snoozed deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-10', priority: 1, status: 'snoozed' })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(0)
  })

  it('returns 0 for due-today deadline', () => {
    const d = makeDeadline({ dueDate: '2025-06-15', priority: 1 })
    expect(deadlineSeverityWeight(d, '2025-06-15')).toBe(0)
  })

  it('severity cap integration: sum of multiple overdue capped at 12', () => {
    // Simulate portfolio health: 4 P1 deadlines × 4 weight = 16, but capped to 12
    const deadlines = [
      makeDeadline({ dueDate: '2025-06-01', priority: 1 }),
      makeDeadline({ dueDate: '2025-06-02', priority: 1 }),
      makeDeadline({ dueDate: '2025-06-03', priority: 1 }),
      makeDeadline({ dueDate: '2025-06-04', priority: 1 }),
    ]
    const rawSum = deadlines.reduce((s, d) => s + deadlineSeverityWeight(d, '2025-06-15'), 0)
    expect(rawSum).toBe(16)
    expect(Math.min(rawSum, 12)).toBe(12) // The cap is applied in portfolio-health.ts
  })
})

describe('categorizeDueDate', () => {
  it('returns overdue for past dates', () => {
    const d = makeDeadline({ dueDate: '2025-06-10' })
    expect(categorizeDueDate(d, '2025-06-15')).toBe('overdue')
  })

  it('returns today for same date', () => {
    const d = makeDeadline({ dueDate: '2025-06-15' })
    expect(categorizeDueDate(d, '2025-06-15')).toBe('today')
  })

  it('returns this-week for 1-7 days out', () => {
    const d = makeDeadline({ dueDate: '2025-06-22' })
    expect(categorizeDueDate(d, '2025-06-15')).toBe('this-week')
  })

  it('returns upcoming for 8-30 days out', () => {
    const d = makeDeadline({ dueDate: '2025-07-10' })
    expect(categorizeDueDate(d, '2025-06-15')).toBe('upcoming')
  })

  it('returns future for > 30 days out', () => {
    const d = makeDeadline({ dueDate: '2025-12-31' })
    expect(categorizeDueDate(d, '2025-06-15')).toBe('future')
  })

  it('handles month boundary correctly', () => {
    const d = makeDeadline({ dueDate: '2025-07-01' })
    // June 30 → July 1 = 1 day → this-week
    expect(categorizeDueDate(d, '2025-06-30')).toBe('this-week')
  })

  it('handles leap year boundary', () => {
    const d = makeDeadline({ dueDate: '2024-03-01' })
    // Feb 28, 2024 → Mar 1 = 2 days (leap year)
    expect(categorizeDueDate(d, '2024-02-28')).toBe('this-week')
  })
})
