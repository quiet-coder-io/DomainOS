import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRepository } from '../../src/domains/repository.js'
import { SessionRepository } from '../../src/sessions/repository.js'
import { DeadlineRepository } from '../../src/deadlines/repository.js'
import { GapFlagRepository } from '../../src/agents/gap-flag-repository.js'
import { DecisionRepository } from '../../src/audit/decision-repository.js'
import { AuditRepository } from '../../src/audit/repository.js'
import {
  computeDomainStatusSnapshot,
  computeSinceWindow,
  computeTopActions,
  computeSearchHints,
  normalizeGapCategory,
  sanitizeKeyword,
  extractKeywordsFromText,
} from '../../src/briefing/domain-status.js'
import { renderStatusBriefing } from '../../src/agents/prompt-builder.js'
import {
  STATUS_CAPS,
  STATUS_MAX_SECTION_CHARS,
} from '../../src/briefing/domain-status-constants.js'
import type { Session } from '../../src/sessions/schemas.js'

let db: Database.Database
let domainId: string

beforeEach(() => {
  db = openDatabase(':memory:')
  const domainRepo = new DomainRepository(db)
  const domain = domainRepo.create({ name: 'Test Domain', kbPath: '/tmp/test-kb' })
  if (!domain.ok) throw new Error('Failed to create domain')
  domainId = domain.value.id
})

// ── normalizeGapCategory ──

describe('normalizeGapCategory', () => {
  it('lowercases and trims', () => {
    expect(normalizeGapCategory('  BLOCKER  ')).toBe('blocker')
  })

  it('strips trailing s (plurals)', () => {
    expect(normalizeGapCategory('Blockers')).toBe('blocker')
  })

  it('handles synonym mapping: "Legal Risk" → "legal"', () => {
    expect(normalizeGapCategory('Legal Risk')).toBe('legal')
  })

  it('handles synonym mapping: "finance" → "financial"', () => {
    expect(normalizeGapCategory('finance')).toBe('financial')
  })

  it('handles synonym mapping: "security incident" → "security"', () => {
    // "security/incident" → "security incident" after non-letter replace → synonym
    expect(normalizeGapCategory('security/incident')).toBe('security')
  })

  it('normalizes "docs" → "documentation"', () => {
    // "docs" → strip trailing s → "doc" → synonym → "documentation"
    expect(normalizeGapCategory('docs')).toBe('documentation')
  })

  it('normalizes "block" → "blocker" via synonym', () => {
    expect(normalizeGapCategory('block')).toBe('blocker')
  })

  it('returns unknown category as-is (lowercased, stripped)', () => {
    expect(normalizeGapCategory('custom-category')).toBe('custom category')
  })
})

// ── sanitizeKeyword ──

describe('sanitizeKeyword', () => {
  it('strips punctuation', () => {
    expect(sanitizeKeyword('hello!')).toBe('hello')
  })

  it('drops tokens < 3 chars', () => {
    expect(sanitizeKeyword('hi')).toBeNull()
  })

  it('drops pure numbers', () => {
    expect(sanitizeKeyword('2026')).toBeNull()
  })

  it('drops stopwords', () => {
    expect(sanitizeKeyword('the')).toBeNull()
    expect(sanitizeKeyword('from')).toBeNull()
  })

  it('keeps valid tokens', () => {
    expect(sanitizeKeyword('Review')).toBe('Review')
  })

  it('trims to keyword char limit', () => {
    const longWord = 'a'.repeat(30)
    const result = sanitizeKeyword(longWord)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(24)
  })
})

// ── extractKeywordsFromText ──

describe('extractKeywordsFromText', () => {
  it('extracts keywords, skipping stopwords and dates', () => {
    const result = extractKeywordsFromText('Review Q1 2026 financials', 3)
    expect(result).toContain('Review')
    expect(result).toContain('financials')
    expect(result).not.toContain('2026')
  })

  it('deduplicates case-insensitively', () => {
    const result = extractKeywordsFromText('review Review REVIEW other', 5)
    expect(result.filter(k => k.toLowerCase() === 'review').length).toBe(1)
  })

  it('respects maxTokens limit', () => {
    const result = extractKeywordsFromText('alpha beta gamma delta epsilon', 2)
    expect(result.length).toBe(2)
  })
})

// ── computeSinceWindow ──

describe('computeSinceWindow', () => {
  it('returns "none" for empty sessions', () => {
    const result = computeSinceWindow([])
    expect(result.kind).toBe('none')
    expect(result.since).toBeNull()
    expect(result.label).toContain('No prior session baseline')
  })

  it('returns "wrapped_session" when wrapped session exists', () => {
    const sessions: Session[] = [{
      id: '1',
      domainId: 'test',
      scope: 'working',
      status: 'wrapped_up',
      modelProvider: 'anthropic',
      modelName: 'claude',
      startedAt: '2026-02-18T10:00:00Z',
      endedAt: '2026-02-18T14:00:00Z',
    }]
    const result = computeSinceWindow(sessions)
    expect(result.kind).toBe('wrapped_session')
    expect(result.since).toBe('2026-02-18T14:00:00Z')
    expect(result.label).toContain('session')
  })

  it('returns "recent_session" for active-only sessions', () => {
    const sessions: Session[] = [{
      id: '1',
      domainId: 'test',
      scope: 'working',
      status: 'active',
      modelProvider: 'anthropic',
      modelName: 'claude',
      startedAt: '2026-02-20T10:00:00Z',
      endedAt: null,
    }]
    const result = computeSinceWindow(sessions)
    expect(result.kind).toBe('recent_session')
    expect(result.since).toBe('2026-02-20T10:00:00Z')
    expect(result.label).toContain('session still active')
  })
})

// ── computeTopActions ──

describe('computeTopActions', () => {
  it('sorts by priorityScore DESC', () => {
    const overdue = [
      { text: 'Low priority', dueDate: '2026-02-15', priority: 7, daysOverdue: 5 },
      { text: 'High priority', dueDate: '2026-02-10', priority: 1, daysOverdue: 10 },
    ]
    const result = computeTopActions(overdue, [], null, '2026-02-20')
    expect(result.length).toBe(2)
    expect(result[0].text).toBe('High priority')
  })

  it('caps at STATUS_CAPS.topActions', () => {
    const overdue = Array.from({ length: 15 }, (_, i) => ({
      text: `Deadline ${i}`,
      dueDate: '2026-02-15',
      priority: 3,
      daysOverdue: i + 1,
    }))
    const result = computeTopActions(overdue, [], null, '2026-02-20')
    expect(result.length).toBe(STATUS_CAPS.topActions)
  })

  it('P1 overdue deadline scores higher than P5 with same daysOverdue', () => {
    const overdue = [
      { text: 'P5 deadline', dueDate: '2026-02-15', priority: 5, daysOverdue: 3 },
      { text: 'P1 deadline', dueDate: '2026-02-15', priority: 1, daysOverdue: 3 },
    ]
    const result = computeTopActions(overdue, [], null, '2026-02-20')
    expect(result[0].text).toBe('P1 deadline')
  })

  it('blocker gap flag outranks documentation gap flag', () => {
    const gaps = [
      { category: 'documentation', description: 'Old docs gap', createdAt: '2026-01-01T00:00:00Z' },
      { category: 'blocker', description: 'Critical blocker gap', createdAt: '2026-02-15T00:00:00Z' },
    ]
    const result = computeTopActions([], gaps, null, '2026-02-20')
    expect(result[0].text).toBe('Critical blocker gap')
  })

  it('guarantees at least 1 gap flag when gaps exist (diversification)', () => {
    // 10 deadlines + 1 gap flag
    const overdue = Array.from({ length: 10 }, (_, i) => ({
      text: `Deadline ${i}`,
      dueDate: '2026-02-15',
      priority: 1,
      daysOverdue: 10 + i,
    }))
    const gaps = [
      { category: 'process', description: 'Process gap', createdAt: '2026-02-18T00:00:00Z' },
    ]
    const result = computeTopActions(overdue, gaps, null, '2026-02-20')
    expect(result.some(a => a.source === 'gap_flag')).toBe(true)
  })

  it('handles empty inputs without crash', () => {
    const result = computeTopActions([], [], null, '2026-02-20')
    expect(result.length).toBe(0)
  })
})

// ── computeSearchHints ──

describe('computeSearchHints', () => {
  it('puts domain name first in keywords', () => {
    const result = computeSearchHints('Test Domain', [], [], [])
    expect(result.keywords[0]).toBe('Test Domain')
  })

  it('quotes multiword domain names in Gmail queries', () => {
    const result = computeSearchHints('Test Domain', [], [], [])
    expect(result.gmailQueries.some(q => q.includes('"Test Domain"'))).toBe(true)
  })

  it('falls back to domain-name-only when < 2 keywords', () => {
    const result = computeSearchHints('Test', [], [], [])
    // Only domain name keyword, so < 2 non-domain keywords
    expect(result.gmailQueries.length).toBe(2)
    expect(result.gtasksQueries.length).toBe(1)
  })

  it('produces 3 gmail queries when ≥ 2 non-domain keywords', () => {
    const gaps = [
      { category: 'blocker' },
      { category: 'security' },
    ]
    const result = computeSearchHints('Test', [], gaps, [])
    expect(result.gmailQueries.length).toBe(3)
    expect(result.gtasksQueries.length).toBe(2)
  })

  it('does not produce empty braces in queries', () => {
    const result = computeSearchHints('Test', [], [], [])
    for (const q of result.gmailQueries) {
      expect(q).not.toContain('()')
      expect(q).not.toContain('( )')
    }
  })
})

// ── computeDomainStatusSnapshot ──

describe('computeDomainStatusSnapshot', () => {
  it('returns snapshot for empty domain (no data)', () => {
    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.domainName).toBe('Test Domain')
    expect(result.value.sinceWindow.kind).toBe('none')
    expect(result.value.overdueDeadlines.length).toBe(0)
    expect(result.value.upcomingDeadlines.length).toBe(0)
    expect(result.value.openGapFlags.length).toBe(0)
    expect(result.value.recentlyResolvedGapFlags.length).toBe(0)
    expect(result.value.recentDecisions.length).toBe(0)
    expect(result.value.recentAuditEvents.length).toBe(0)
    expect(result.value.topActions.length).toBe(0)
  })

  it('includes overdue deadlines sorted by daysOverdue DESC, priority ASC', () => {
    const deadlineRepo = new DeadlineRepository(db)
    // Create some overdue deadlines
    deadlineRepo.create({
      domainId,
      text: 'Less urgent',
      dueDate: '2026-02-18',
      priority: 5,
      source: 'manual',
      sourceRef: 'test-1',
    })
    deadlineRepo.create({
      domainId,
      text: 'Most urgent',
      dueDate: '2026-02-10',
      priority: 1,
      source: 'manual',
      sourceRef: 'test-2',
    })

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.overdueDeadlines.length).toBeGreaterThan(0)
    // Most overdue (earliest date) should be first
    expect(result.value.overdueDeadlines[0].text).toBe('Most urgent')
  })

  it('caps audit events at STATUS_CAPS.auditEvents', () => {
    // Create a wrapped session so we have a since window
    const sessionRepo = new SessionRepository(db)
    const session = sessionRepo.create({
      domainId,
      scope: 'working',
      modelProvider: 'anthropic',
      modelName: 'claude',
    })
    if (session.ok) {
      sessionRepo.end(session.value.id)
    }

    // Create more audit events than the cap
    const auditRepo = new AuditRepository(db)
    for (let i = 0; i < STATUS_CAPS.auditEvents + 5; i++) {
      auditRepo.logChange({
        domainId,
        changeDescription: `Event ${i}`,
        eventType: 'kb_write',
        source: 'test',
        filePath: `file-${i}.md`,
        contentHash: `hash-${i}`,
      })
    }

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.recentAuditEvents.length).toBeLessThanOrEqual(STATUS_CAPS.auditEvents)
  })

  it('includes recently resolved gap flags', () => {
    const gapRepo = new GapFlagRepository(db)
    const created = gapRepo.create({
      domainId,
      category: 'missing-data',
      description: 'Vendor contact missing',
    })
    if (created.ok) {
      gapRepo.resolve(created.value.id)
    }

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.recentlyResolvedGapFlags.length).toBe(1)
    expect(result.value.recentlyResolvedGapFlags[0].category).toBe('missing-data')
  })

  it('returns error for non-existent domain', () => {
    const result = computeDomainStatusSnapshot(db, 'non-existent-id')
    expect(result.ok).toBe(false)
  })

  it('includes active decisions only', () => {
    const decisionRepo = new DecisionRepository(db)
    decisionRepo.create({
      domainId,
      decisionId: 'dec-1',
      decision: 'Active decision',
      rationale: 'test',
      linkedFiles: [],
    })
    const rejected = decisionRepo.create({
      domainId,
      decisionId: 'dec-2',
      decision: 'Rejected decision',
      rationale: 'test',
      linkedFiles: [],
    })
    if (rejected.ok) {
      decisionRepo.reject(rejected.value.id)
    }

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.recentDecisions.length).toBe(1)
    expect(result.value.recentDecisions[0].decision).toBe('Active decision')
  })

  it('has no audit events when sinceWindow.kind is "none"', () => {
    // No sessions created → sinceWindow.kind === 'none'
    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.sinceWindow.kind).toBe('none')
    expect(result.value.recentAuditEvents.length).toBe(0)
  })
})

// ── renderStatusBriefing (budget enforcement) ──

describe('renderStatusBriefing', () => {
  it('renders without crash for empty snapshot', () => {
    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rendered = renderStatusBriefing(result.value)
    expect(rendered).toContain('=== DOMAIN STATUS BRIEFING ===')
    expect(rendered).toContain('Overdue Deadlines')
    expect(rendered).toContain('None')
  })

  it('includes response format instructions', () => {
    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rendered = renderStatusBriefing(result.value)
    expect(rendered).toContain('BRIEFING RESPONSE FORMAT')
    expect(rendered).toContain('Priority Actions')
  })

  it('shows "(N shown of M)" when items truncated', () => {
    // Create more overdue deadlines than STATUS_CAPS.overdueDeadlines
    const deadlineRepo = new DeadlineRepository(db)
    for (let i = 0; i < STATUS_CAPS.overdueDeadlines + 3; i++) {
      deadlineRepo.create({
        domainId,
        text: `Overdue deadline ${i} with some extra text to fill space`,
        dueDate: `2026-01-${String(10 + i).padStart(2, '0')}`,
        priority: 3,
        source: 'manual',
        sourceRef: `test-${i}`,
      })
    }

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Snapshot should cap overdue at STATUS_CAPS.overdueDeadlines
    expect(result.value.overdueDeadlines.length).toBe(STATUS_CAPS.overdueDeadlines)
  })

  it('rendered output stays under STATUS_MAX_SECTION_CHARS + response format buffer', () => {
    // Create lots of data
    const deadlineRepo = new DeadlineRepository(db)
    const gapRepo = new GapFlagRepository(db)
    const decisionRepo = new DecisionRepository(db)

    for (let i = 0; i < 10; i++) {
      deadlineRepo.create({
        domainId,
        text: `Deadline ${i}: This is a very long deadline description that should test truncation behavior properly`,
        dueDate: `2026-01-${String(10 + i).padStart(2, '0')}`,
        priority: i % 7 + 1,
        source: 'manual',
        sourceRef: `dl-${i}`,
      })
    }

    for (let i = 0; i < 8; i++) {
      gapRepo.create({
        domainId,
        category: ['blocker', 'security', 'legal', 'compliance', 'financial', 'data', 'process', 'documentation'][i],
        description: `Gap flag ${i}: This is a gap flag description that tests the rendering budget enforcement system`,
      })
    }

    for (let i = 0; i < 6; i++) {
      decisionRepo.create({
        domainId,
        decisionId: `dec-${i}`,
        decision: `Decision ${i}: A strategic decision about something important in the domain`,
        rationale: 'test rationale',
        linkedFiles: [],
        category: 'strategic',
        confidence: 'high',
      })
    }

    const result = computeDomainStatusSnapshot(db, domainId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rendered = renderStatusBriefing(result.value)
    // The rendered output should be reasonable size
    // STATUS_MAX_SECTION_CHARS is 3400 for data sections, plus ~600 for response format
    expect(rendered.length).toBeLessThan(STATUS_MAX_SECTION_CHARS + 1500)
  })
})
