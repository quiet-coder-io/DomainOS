/**
 * Domain status snapshot — pre-computed briefing data for status intent queries.
 * Parallels portfolio-health.ts but scoped to a single domain with ranked actions.
 */

import type Database from 'better-sqlite3'
import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import { DomainRepository } from '../domains/repository.js'
import { SessionRepository } from '../sessions/repository.js'
import { DeadlineRepository } from '../deadlines/repository.js'
import { GapFlagRepository } from '../agents/gap-flag-repository.js'
import { DecisionRepository } from '../audit/decision-repository.js'
import { AuditRepository } from '../audit/repository.js'
import { AdvisoryRepository } from '../advisory/repository.js'
import { daysUntilDue, todayISO } from '../deadlines/evaluation.js'
import type { Session } from '../sessions/schemas.js'
import type { Deadline } from '../deadlines/schemas.js'
import type { GapFlag } from '../agents/gap-flag-repository.js'
import type { Decision } from '../audit/schemas.js'
import {
  STATUS_CAPS,
  STATUS_CHAR_LIMITS,
  GAP_CATEGORY_WEIGHTS,
  GAP_DEFAULT_WEIGHT,
  GAP_CATEGORY_SYNONYMS,
  PRIORITY_MAX,
  PRIORITY_DEFAULT,
  SCORING,
  STOPWORDS,
} from './domain-status-constants.js'

// ── Types ──

export interface SinceWindow {
  kind: 'wrapped_session' | 'recent_session' | 'none'
  since: string | null
  label: string
}

export interface SearchHints {
  keywords: string[]
  gmailQueries: string[]
  gtasksQueries: string[]
}

export interface RankedAction {
  text: string
  source: 'deadline' | 'gap_flag' | 'kb_staleness'
  priorityScore: number
  rationale: string
  dueDate?: string
}

export interface DomainStatusSnapshot {
  snapshotVersion: 1
  domainId: string
  domainName: string
  computedAt: string

  sinceWindow: SinceWindow

  severityScore: number
  status: 'active' | 'quiet' | 'stale-risk' | 'blocked'
  kbStalenessHeadline: string
  topActions: RankedAction[]

  recentAuditEvents: Array<{ eventType: string; description: string; createdAt: string }>
  recentDecisions: Array<{ decisionId: string; decision: string; category: string | null; confidence: string | null; createdAt: string }>
  overdueDeadlines: Array<{ text: string; dueDate: string; priority: number; daysOverdue: number }>
  upcomingDeadlines: Array<{ text: string; dueDate: string; priority: number; daysUntilDue: number }>
  openGapFlags: Array<{ category: string; description: string; createdAt: string }>
  recentlyResolvedGapFlags: Array<{ category: string; description: string; resolvedAt: string }>

  recentArtifacts: Array<{ type: string; title: string; createdAt: string }>

  searchHints: SearchHints
}

// ── Gap Category Normalization ──

export function normalizeGapCategory(raw: string): string {
  let cat = raw.toLowerCase().trim()
  // Replace non-letter chars with spaces, collapse whitespace
  cat = cat.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  // Strip trailing "s" (plurals)
  if (cat.length > 1 && cat.endsWith('s')) {
    cat = cat.slice(0, -1)
  }
  // Synonym lookup
  if (cat in GAP_CATEGORY_SYNONYMS) {
    cat = GAP_CATEGORY_SYNONYMS[cat]
  }
  return cat
}

function gapCategoryWeight(raw: string): number {
  const normalized = normalizeGapCategory(raw)
  return GAP_CATEGORY_WEIGHTS[normalized] ?? GAP_DEFAULT_WEIGHT
}

// ── Since Window ──

export function computeSinceWindow(sessions: Session[]): SinceWindow {
  // Find most recent wrapped session
  const wrapped = sessions.find(s => s.status === 'wrapped_up' && s.endedAt)
  if (wrapped && wrapped.endedAt) {
    const date = new Date(wrapped.endedAt)
    const label = `Since ${formatDateHuman(date)} session`
    return { kind: 'wrapped_session', since: wrapped.endedAt, label }
  }

  // Any session at all (active or otherwise)
  if (sessions.length > 0) {
    const latest = sessions[0] // already sorted DESC by started_at
    const date = new Date(latest.startedAt)
    const label = `Since ${formatDateHuman(date)} (session still active)`
    return { kind: 'recent_session', since: latest.startedAt, label }
  }

  return { kind: 'none', since: null, label: 'No prior session baseline; showing current state only.' }
}

function formatDateHuman(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Keyword Sanitization ──

export function sanitizeKeyword(raw: string): string | null {
  // Strip punctuation
  let token = raw.replace(/[^\w]/g, '')
  // Drop tokens < 3 chars
  if (token.length < 3) return null
  // Drop pure numbers
  if (/^\d+$/.test(token)) return null
  // Drop dates (YYYY-MM-DD pattern)
  if (/^\d{4}\d{2}\d{2}$/.test(token)) return null
  // Drop stopwords (case-insensitive)
  if (STOPWORDS.has(token.toLowerCase())) return null
  // Trim to char limit
  if (token.length > STATUS_CHAR_LIMITS.keyword) {
    token = token.slice(0, STATUS_CHAR_LIMITS.keyword)
  }
  return token.length > 0 ? token : null
}

export function extractKeywordsFromText(text: string, maxTokens: number): string[] {
  const tokens = text.split(/\s+/)
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of tokens) {
    if (result.length >= maxTokens) break
    const sanitized = sanitizeKeyword(t)
    if (sanitized && !seen.has(sanitized.toLowerCase())) {
      seen.add(sanitized.toLowerCase())
      result.push(sanitized)
    }
  }
  return result
}

// ── Search Hints ──

export function computeSearchHints(
  domainName: string,
  decisions: Array<{ decision: string }>,
  gapFlags: Array<{ category: string }>,
  deadlines: Array<{ text: string }>,
): SearchHints {
  const keywordSet = new Set<string>()
  const keywords: string[] = []

  function addKeyword(kw: string): void {
    const lower = kw.toLowerCase()
    if (!keywordSet.has(lower)) {
      keywordSet.add(lower)
      keywords.push(kw)
    }
  }

  // Domain name always first (unfiltered)
  addKeyword(domainName)

  // Top 3 gap flag categories
  const catsSeen = new Set<string>()
  for (const g of gapFlags) {
    if (catsSeen.size >= 3) break
    const normalized = normalizeGapCategory(g.category)
    if (!catsSeen.has(normalized)) {
      catsSeen.add(normalized)
      addKeyword(normalized)
    }
  }

  // Keywords from top 2 overdue deadlines
  for (const d of deadlines.slice(0, 2)) {
    for (const kw of extractKeywordsFromText(d.text, 2)) {
      if (keywords.length >= 8) break
      addKeyword(kw)
    }
  }

  // Keywords from top 2 decisions
  for (const d of decisions.slice(0, 2)) {
    for (const kw of extractKeywordsFromText(d.decision, 2)) {
      if (keywords.length >= 8) break
      addKeyword(kw)
    }
  }

  // Trim to 8 max
  const finalKeywords = keywords.slice(0, 8)

  // Helper: quote if contains spaces
  function q(s: string): string {
    return s.includes(' ') ? `"${s}"` : s
  }

  const quotedDomain = q(domainName)
  const nonDomainKeywords = finalKeywords.filter(k => k.toLowerCase() !== domainName.toLowerCase())

  // Build Gmail queries
  const gmailQueries: string[] = []
  if (nonDomainKeywords.length >= 2) {
    gmailQueries.push(`subject:(${q(nonDomainKeywords[0])} OR ${q(nonDomainKeywords[1])}) newer_than:14d`)
    gmailQueries.push(`(${quotedDomain} OR ${q(nonDomainKeywords[0])}) newer_than:30d`)
    gmailQueries.push(`(${quotedDomain}) newer_than:7d is:unread`)
  } else {
    gmailQueries.push(`(${quotedDomain}) newer_than:14d`)
    gmailQueries.push(`(${quotedDomain}) newer_than:7d is:unread`)
  }

  // Build GTasks queries
  const gtasksQueries: string[] = []
  gtasksQueries.push(`"${domainName}"`)
  if (nonDomainKeywords.length >= 2) {
    gtasksQueries.push(`${nonDomainKeywords[0]} ${nonDomainKeywords[1]}`)
  }

  return { keywords: finalKeywords, gmailQueries, gtasksQueries }
}

// ── Priority Scoring ──

function clampPriority(priority: number | null | undefined): number {
  const p = priority ?? PRIORITY_DEFAULT
  return Math.max(1, Math.min(PRIORITY_MAX, p))
}

function scoreDeadline(daysOverdue: number, priority: number): number {
  const clamped = clampPriority(priority)
  return SCORING.deadlineBase + (daysOverdue * SCORING.deadlinePerDay) + ((PRIORITY_MAX + 1 - clamped) * SCORING.deadlinePerPriority)
}

function scoreGapFlag(category: string, createdAt: string, today: string): number {
  const weight = gapCategoryWeight(category)
  const createdMs = new Date(createdAt).getTime()
  const todayMs = new Date(today + 'T00:00:00Z').getTime()
  const ageDays = Math.round((todayMs - createdMs) / 86_400_000)
  const ageBonus = ageDays > SCORING.gapAgeDays ? SCORING.gapAgeBonus : 0
  return SCORING.gapBase + weight + ageBonus
}

// ── Top Actions ──

export function computeTopActions(
  overdueDeadlines: Array<{ text: string; dueDate: string; priority: number; daysOverdue: number }>,
  openGapFlags: Array<{ category: string; description: string; createdAt: string }>,
  kbStaleness: { daysSinceUpdate: number; headline: string } | null,
  today: string,
): RankedAction[] {
  const actions: RankedAction[] = []

  // Deadline actions
  for (const d of overdueDeadlines) {
    const score = scoreDeadline(d.daysOverdue, d.priority)
    actions.push({
      text: d.text,
      source: 'deadline',
      priorityScore: score,
      rationale: `P${d.priority} ${d.daysOverdue}d overdue`,
      dueDate: d.dueDate,
    })
  }

  // Gap flag actions
  for (const g of openGapFlags) {
    const score = scoreGapFlag(g.category, g.createdAt, today)
    const weight = gapCategoryWeight(g.category)
    const normalized = normalizeGapCategory(g.category)
    const createdMs = new Date(g.createdAt).getTime()
    const todayMs = new Date(today + 'T00:00:00Z').getTime()
    const ageDays = Math.round((todayMs - createdMs) / 86_400_000)
    actions.push({
      text: g.description,
      source: 'gap_flag',
      priorityScore: score,
      rationale: `Category weight +${weight} (${normalized}), open ${ageDays}d`,
    })
  }

  // KB staleness action
  if (kbStaleness && kbStaleness.daysSinceUpdate > 0) {
    const score = SCORING.kbBase + Math.floor(kbStaleness.daysSinceUpdate * SCORING.kbPerDay)
    actions.push({
      text: kbStaleness.headline,
      source: 'kb_staleness',
      priorityScore: score,
      rationale: `KB stale ${kbStaleness.daysSinceUpdate}d`,
    })
  }

  // Sort by score DESC
  actions.sort((a, b) => b.priorityScore - a.priorityScore)

  // Diversification: ensure at least 1 gap flag if gaps exist
  const sliced = actions.slice(0, STATUS_CAPS.topActions)
  if (openGapFlags.length > 0 && !sliced.some(a => a.source === 'gap_flag')) {
    const bestGap = actions.find(a => a.source === 'gap_flag')
    if (bestGap && sliced.length > 0) {
      sliced[sliced.length - 1] = bestGap
    }
  }

  return sliced
}

// ── KB Staleness ──

interface KBFileRow {
  relative_path: string
  tier: string
  last_synced_at: string
}

function computeKBStaleness(db: Database.Database, domainId: string): { daysSinceUpdate: number; headline: string; severityContribution: number } {
  const now = Date.now()
  const kbFiles = db.prepare('SELECT relative_path, tier, last_synced_at FROM kb_files WHERE domain_id = ?')
    .all(domainId) as KBFileRow[]

  if (kbFiles.length === 0) {
    return { daysSinceUpdate: 0, headline: 'No KB files tracked', severityContribution: 0 }
  }

  let staleCount = 0
  let criticalCount = 0
  let worstDays = 0
  let worstPath = ''

  for (const f of kbFiles) {
    const syncedAt = new Date(f.last_synced_at).getTime()
    const daysSince = Math.round((now - syncedAt) / 86_400_000)
    if (daysSince > worstDays) {
      worstDays = daysSince
      worstPath = f.relative_path
    }
    if (daysSince >= 30) criticalCount++
    else if (daysSince >= 14) staleCount++
  }

  const severityContribution = criticalCount * 2 + staleCount
  let headline: string
  if (criticalCount > 0) {
    headline = `${criticalCount} critical, ${staleCount} stale of ${kbFiles.length} files (worst: ${worstPath} at ${worstDays}d)`
  } else if (staleCount > 0) {
    headline = `${staleCount} stale of ${kbFiles.length} files (worst: ${worstPath} at ${worstDays}d)`
  } else {
    headline = `All ${kbFiles.length} files fresh`
  }

  return { daysSinceUpdate: worstDays, headline, severityContribution }
}

// ── Domain Status Derivation ──

function deriveStatus(
  severityScore: number,
  overdueCount: number,
  openGapCount: number,
): 'active' | 'quiet' | 'stale-risk' | 'blocked' {
  // Blocked requires manual structural assessment (not derivable from status data alone)
  // Approximate: many overdue + high severity
  if (overdueCount >= 3 && severityScore >= 15) return 'blocked'
  if (severityScore >= 5) return 'stale-risk'
  if (severityScore === 0 && overdueCount === 0 && openGapCount === 0) return 'quiet'
  return 'active'
}

// ── Main Snapshot Function ──

export function computeDomainStatusSnapshot(
  db: Database.Database,
  domainId: string,
): Result<DomainStatusSnapshot, DomainOSError> {
  try {
    const domainRepo = new DomainRepository(db)
    const domain = domainRepo.getById(domainId)
    if (!domain.ok) return Err(domain.error)

    const today = todayISO()

    // Sessions
    const sessionRepo = new SessionRepository(db)
    const sessions = sessionRepo.getByDomain(domainId, 10)
    if (!sessions.ok) return Err(sessions.error)
    const sinceWindow = computeSinceWindow(sessions.value)

    // Deadlines
    const deadlineRepo = new DeadlineRepository(db)
    const overdueResult = deadlineRepo.getOverdue(domainId, today)
    if (!overdueResult.ok) return Err(overdueResult.error)
    const upcomingResult = deadlineRepo.getUpcoming(domainId, 14, today)
    if (!upcomingResult.ok) return Err(upcomingResult.error)

    // Sort overdue: daysOverdue DESC, priority ASC (most urgent first)
    const overdueWithDays = overdueResult.value.map((d: Deadline) => ({
      text: d.text,
      dueDate: d.dueDate,
      priority: d.priority,
      daysOverdue: -daysUntilDue(d, today),
    }))
    overdueWithDays.sort((a, b) => b.daysOverdue - a.daysOverdue || a.priority - b.priority)
    const overdueDeadlines = overdueWithDays.slice(0, STATUS_CAPS.overdueDeadlines)

    // Sort upcoming: daysUntilDue ASC, priority ASC (soonest + highest urgency first)
    const upcomingWithDays = upcomingResult.value.map((d: Deadline) => ({
      text: d.text,
      dueDate: d.dueDate,
      priority: d.priority,
      daysUntilDue: daysUntilDue(d, today),
    }))
    upcomingWithDays.sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.priority - b.priority)
    const upcomingDeadlines = upcomingWithDays.slice(0, STATUS_CAPS.upcomingDeadlines)

    // Gap flags
    const gapRepo = new GapFlagRepository(db)
    const openResult = gapRepo.getOpen(domainId)
    if (!openResult.ok) return Err(openResult.error)
    const openGapFlags = openResult.value.slice(0, STATUS_CAPS.openGapFlags).map((g: GapFlag) => ({
      category: g.category,
      description: g.description,
      createdAt: g.createdAt,
    }))
    const resolvedResult = gapRepo.getRecentlyResolved(domainId, STATUS_CAPS.resolvedGapFlags)
    if (!resolvedResult.ok) return Err(resolvedResult.error)
    const recentlyResolvedGapFlags = resolvedResult.value.map((g: GapFlag) => ({
      category: g.category,
      description: g.description,
      resolvedAt: g.resolvedAt ?? g.updatedAt,
    }))

    // Decisions (active only)
    const decisionRepo = new DecisionRepository(db)
    const decisionsResult = decisionRepo.getByDomain(domainId, STATUS_CAPS.decisions)
    if (!decisionsResult.ok) return Err(decisionsResult.error)
    const recentDecisions = decisionsResult.value
      .filter((d: Decision) => d.status === 'active')
      .slice(0, STATUS_CAPS.decisions)
      .map((d: Decision) => ({
        decisionId: d.decisionId,
        decision: d.decision,
        category: d.category,
        confidence: d.confidence,
        createdAt: d.createdAt,
      }))

    // Audit events (only if we have a since date)
    let recentAuditEvents: Array<{ eventType: string; description: string; createdAt: string }> = []
    if (sinceWindow.since) {
      const auditRepo = new AuditRepository(db)
      const auditResult = auditRepo.getByDomainSince(domainId, sinceWindow.since, STATUS_CAPS.auditEvents)
      if (auditResult.ok) {
        recentAuditEvents = auditResult.value.map(e => ({
          eventType: e.eventType,
          description: e.changeDescription,
          createdAt: e.createdAt,
        }))
      }
    }

    // Advisory artifacts
    const advisoryRepo = new AdvisoryRepository(db)
    const artifactsResult = advisoryRepo.getByDomain(domainId, { limit: STATUS_CAPS.artifacts })
    const recentArtifacts = artifactsResult.ok
      ? artifactsResult.value.map(a => ({
          type: a.type,
          title: a.title,
          createdAt: a.createdAt,
        }))
      : []

    // KB staleness
    const kbStaleness = computeKBStaleness(db, domainId)

    // Severity score
    const gapWeight = openResult.value.length * 2
    const deadlineWeight = overdueResult.value.reduce((sum: number, d: Deadline) => {
      if (d.priority <= 2) return sum + 4
      if (d.priority <= 4) return sum + 2
      return sum + 1
    }, 0)
    const severityScore = gapWeight + Math.min(deadlineWeight, 12) + kbStaleness.severityContribution
    const status = deriveStatus(severityScore, overdueResult.value.length, openResult.value.length)

    // Top actions
    const kbForActions = kbStaleness.daysSinceUpdate >= 14
      ? { daysSinceUpdate: kbStaleness.daysSinceUpdate, headline: kbStaleness.headline }
      : null
    const topActions = computeTopActions(overdueDeadlines, openGapFlags, kbForActions, today)

    // Search hints
    const searchHints = computeSearchHints(
      domain.value.name,
      recentDecisions,
      openGapFlags,
      overdueDeadlines,
    )

    return Ok({
      snapshotVersion: 1 as const,
      domainId,
      domainName: domain.value.name,
      computedAt: new Date().toISOString(),
      sinceWindow,
      severityScore,
      status,
      kbStalenessHeadline: kbStaleness.headline,
      topActions,
      recentAuditEvents,
      recentDecisions,
      overdueDeadlines,
      upcomingDeadlines,
      openGapFlags,
      recentlyResolvedGapFlags,
      recentArtifacts,
      searchHints,
    })
  } catch (e) {
    return Err(DomainOSError.db((e as Error).message))
  }
}
