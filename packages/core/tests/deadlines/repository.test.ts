import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DeadlineRepository } from '../../src/deadlines/repository.js'
import { DomainRepository } from '../../src/domains/repository.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let repo: DeadlineRepository
let domainId: string
let domainId2: string

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new DeadlineRepository(db)
  const domainRepo = new DomainRepository(db)
  const d1 = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!d1.ok) throw new Error('Failed to create domain')
  domainId = d1.value.id
  const d2 = domainRepo.create({ name: 'Second Domain', kbPath: '/tmp/test-kb-2' })
  if (!d2.ok) throw new Error('Failed to create domain 2')
  domainId2 = d2.value.id
})

describe('DeadlineRepository', () => {
  // ── Create ──

  it('creates a deadline with default values', () => {
    const result = repo.create({
      domainId,
      text: 'File quarterly report',
      dueDate: '2025-06-15',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('active')
    expect(result.value.priority).toBe(4)
    expect(result.value.source).toBe('manual')
    expect(result.value.sourceRef).toBe('')
    expect(result.value.snoozedUntil).toBeNull()
    expect(result.value.completedAt).toBeNull()
    expect(result.value.cancelledAt).toBeNull()
  })

  it('creates with explicit priority and source', () => {
    const result = repo.create({
      domainId,
      text: 'Urgent task',
      dueDate: '2025-06-01',
      priority: 1,
      source: 'briefing',
      sourceRef: 'abc123',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.priority).toBe(1)
    expect(result.value.source).toBe('briefing')
    expect(result.value.sourceRef).toBe('abc123')
  })

  it('rejects invalid priority', () => {
    const result = repo.create({
      domainId,
      text: 'Bad priority',
      dueDate: '2025-06-15',
      priority: 0,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects priority > 7', () => {
    const result = repo.create({
      domainId,
      text: 'Bad priority',
      dueDate: '2025-06-15',
      priority: 8,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = repo.create({
      domainId,
      text: 'Bad date',
      dueDate: '2025/06/15',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects empty text', () => {
    const result = repo.create({
      domainId,
      text: '',
      dueDate: '2025-06-15',
    })
    expect(result.ok).toBe(false)
  })

  // ── Query ──

  it('getByDomain returns all deadlines ordered by due_date', () => {
    repo.create({ domainId, text: 'Later', dueDate: '2025-07-01' })
    repo.create({ domainId, text: 'Sooner', dueDate: '2025-06-01' })

    const result = repo.getByDomain(domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBe(2)
    expect(result.value[0].text).toBe('Sooner')
    expect(result.value[1].text).toBe('Later')
  })

  it('getByDomain with status filter', () => {
    const d1 = repo.create({ domainId, text: 'Active', dueDate: '2025-06-01' })
    repo.create({ domainId, text: 'Will complete', dueDate: '2025-06-02' })
    if (d1.ok) repo.complete(d1.value.id)

    const active = repo.getByDomain(domainId, { status: 'active' })
    expect(active.ok).toBe(true)
    if (active.ok) expect(active.value.length).toBe(1)

    const completed = repo.getByDomain(domainId, { status: 'completed' })
    expect(completed.ok).toBe(true)
    if (completed.ok) expect(completed.value.length).toBe(1)
  })

  it('getActive returns only active deadlines', () => {
    repo.create({ domainId, text: 'Active', dueDate: '2025-06-01' })
    const d2 = repo.create({ domainId, text: 'Will snooze', dueDate: '2025-06-02' })
    if (d2.ok) repo.snooze(d2.value.id, '2025-07-01')

    const result = repo.getActive(domainId)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.length).toBe(1)
  })

  // ── Overdue ──

  it('getOverdue returns active deadlines before today', () => {
    repo.create({ domainId, text: 'Past due', dueDate: '2025-01-01' })
    repo.create({ domainId, text: 'Today due', dueDate: '2025-06-15' })
    repo.create({ domainId, text: 'Future', dueDate: '2025-12-31' })

    const result = repo.getOverdue(domainId, '2025-06-15')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBe(1)
    expect(result.value[0].text).toBe('Past due')
  })

  it('getOverdue across all domains', () => {
    repo.create({ domainId, text: 'Domain 1 overdue', dueDate: '2025-01-01' })
    repo.create({ domainId: domainId2, text: 'Domain 2 overdue', dueDate: '2025-02-01' })
    repo.create({ domainId, text: 'Not overdue', dueDate: '2025-12-31' })

    const result = repo.getOverdue(undefined, '2025-06-15')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBe(2)
  })

  it('getOverdue with frozen today parameter', () => {
    repo.create({ domainId, text: 'Due yesterday', dueDate: '2025-06-14' })
    repo.create({ domainId, text: 'Due today', dueDate: '2025-06-15' })

    // Freeze today at June 15
    const r1 = repo.getOverdue(domainId, '2025-06-15')
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.value.length).toBe(1)

    // Freeze today at June 16 — now both are overdue? No, June 15 is also overdue
    const r2 = repo.getOverdue(domainId, '2025-06-16')
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.value.length).toBe(2)
  })

  // ── Upcoming ──

  it('getUpcoming returns active within N days', () => {
    repo.create({ domainId, text: 'Tomorrow', dueDate: '2025-06-16' })
    repo.create({ domainId, text: 'Next week', dueDate: '2025-06-22' })
    repo.create({ domainId, text: 'Far future', dueDate: '2025-12-31' })

    const result = repo.getUpcoming(domainId, 7, '2025-06-15')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.length).toBe(2)
  })

  // ── Snooze / Unsnooze ──

  it('snooze sets status and snoozed_until', () => {
    const d = repo.create({ domainId, text: 'Snooze me', dueDate: '2025-06-01' })
    if (!d.ok) return

    const result = repo.snooze(d.value.id, '2025-06-10')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('snoozed')
    expect(result.value.snoozedUntil).toBe('2025-06-10')
  })

  it('snooze requires valid date', () => {
    const d = repo.create({ domainId, text: 'Snooze me', dueDate: '2025-06-01' })
    if (!d.ok) return

    const result = repo.snooze(d.value.id, 'not-a-date')
    expect(result.ok).toBe(false)
  })

  it('unsnoozeDue wakes snoozed deadlines', () => {
    const d1 = repo.create({ domainId, text: 'Snoozed past', dueDate: '2025-05-01' })
    const d2 = repo.create({ domainId, text: 'Snoozed future', dueDate: '2025-05-01' })
    if (!d1.ok || !d2.ok) return

    repo.snooze(d1.value.id, '2025-06-10')
    repo.snooze(d2.value.id, '2025-07-01')

    const result = repo.unsnoozeDue('2025-06-15')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(1) // Only d1 snoozed until June 10

    // d1 should now be active
    const active = repo.getActive(domainId)
    expect(active.ok).toBe(true)
    if (!active.ok) return
    expect(active.value.length).toBe(1)
    expect(active.value[0].text).toBe('Snoozed past')
    expect(active.value[0].snoozedUntil).toBeNull()
  })

  it('snooze past-due → unsnooze → immediately overdue', () => {
    const d = repo.create({ domainId, text: 'Overdue and snoozed', dueDate: '2025-01-01' })
    if (!d.ok) return

    repo.snooze(d.value.id, '2025-06-10')

    // Not overdue while snoozed
    const overdueBefore = repo.getOverdue(domainId, '2025-06-15')
    expect(overdueBefore.ok).toBe(true)
    if (overdueBefore.ok) expect(overdueBefore.value.length).toBe(0)

    // Unsnooze
    repo.unsnoozeDue('2025-06-15')

    // Now overdue
    const overdueAfter = repo.getOverdue(domainId, '2025-06-15')
    expect(overdueAfter.ok).toBe(true)
    if (overdueAfter.ok) expect(overdueAfter.value.length).toBe(1)
  })

  // ── Complete / Cancel ──

  it('complete sets status and timestamp', () => {
    const d = repo.create({ domainId, text: 'Complete me', dueDate: '2025-06-01' })
    if (!d.ok) return

    const result = repo.complete(d.value.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('completed')
    expect(result.value.completedAt).not.toBeNull()
  })

  it('cancel sets status and timestamp', () => {
    const d = repo.create({ domainId, text: 'Cancel me', dueDate: '2025-06-01' })
    if (!d.ok) return

    const result = repo.cancel(d.value.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('cancelled')
    expect(result.value.cancelledAt).not.toBeNull()
  })

  it('returns error for non-existent deadline', () => {
    expect(repo.complete('non-existent').ok).toBe(false)
    expect(repo.cancel('non-existent').ok).toBe(false)
    expect(repo.snooze('non-existent', '2025-06-01').ok).toBe(false)
  })

  // ── Source ref ──

  it('findBySourceRef returns matching deadline', () => {
    repo.create({
      domainId,
      text: 'From briefing',
      dueDate: '2025-06-01',
      source: 'briefing',
      sourceRef: 'ref-abc',
    })

    const result = repo.findBySourceRef(domainId, 'ref-abc')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).not.toBeNull()
      expect(result.value!.sourceRef).toBe('ref-abc')
    }
  })

  it('findBySourceRef returns null for no match', () => {
    const result = repo.findBySourceRef(domainId, 'non-existent')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('findBySourceRef ignores empty source_ref', () => {
    repo.create({ domainId, text: 'No ref', dueDate: '2025-06-01' })

    const result = repo.findBySourceRef(domainId, '')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })
})
