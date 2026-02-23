/**
 * Advisory tool definitions and executors for LLM tool-use.
 *
 * 4 read-only tools that make advisory sessions data-aware:
 * - advisory_search_decisions: search decisions with rationale
 * - advisory_search_deadlines: search deadlines by domain/priority/date
 * - advisory_cross_domain_context: labeled cross-domain payload
 * - advisory_risk_snapshot: severity breakdown with trend
 *
 * All output-capped: 10 items max, 300 char string truncation.
 * Provider-agnostic ToolDefinition type.
 */

import type Database from 'better-sqlite3'
import type { ToolDefinition } from '@domain-os/core'

/** Max items per tool response. */
const MAX_ITEMS = 10

/** Max chars for truncated string fields. */
const MAX_FIELD_CHARS = 300

function truncField(s: string | null | undefined): string {
  if (!s) return ''
  if (s.length <= MAX_FIELD_CHARS) return s
  return s.slice(0, MAX_FIELD_CHARS) + '...'
}

// ── Tool Definitions ──

export const ADVISORY_TOOLS: ToolDefinition[] = [
  {
    name: 'advisory_search_decisions',
    description:
      'Search decisions across one or all domains. Returns matching decisions with rationale, revisit triggers, and status. Max 10 results.',
    inputSchema: {
      type: 'object',
      properties: {
        domainId: {
          type: 'string',
          description: 'Domain ID to search within. Omit to search all domains.',
        },
        query: {
          type: 'string',
          description: 'Search text to match against decision text and rationale.',
        },
        status: {
          type: 'string',
          enum: ['active', 'superseded', 'rejected'],
          description: 'Filter by decision status. Default: active.',
        },
        limit: {
          type: 'number',
          description: 'Max results 1-10, default 10.',
        },
      },
      required: [],
    },
  },
  {
    name: 'advisory_search_deadlines',
    description:
      'Search deadlines across one or all domains. Returns deadlines with domain name, priority, and days until due. Max 10 results.',
    inputSchema: {
      type: 'object',
      properties: {
        domainId: {
          type: 'string',
          description: 'Domain ID to search within. Omit to search all domains.',
        },
        daysAhead: {
          type: 'number',
          description: 'Return deadlines due within this many days. Default 30.',
        },
        priority: {
          type: 'number',
          description: 'Filter by priority (1-7, lower is more urgent).',
        },
        includeOverdue: {
          type: 'boolean',
          description: 'Include overdue deadlines. Default true.',
        },
      },
      required: [],
    },
  },
  {
    name: 'advisory_cross_domain_context',
    description:
      'Get structured cross-domain context for a domain: sibling health, recent decisions, and overdue deadlines. Every item labeled with source domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domainId: {
          type: 'string',
          description: 'The domain ID to get cross-domain context for.',
        },
      },
      required: ['domainId'],
    },
  },
  {
    name: 'advisory_risk_snapshot',
    description:
      'Get a risk/severity snapshot for a domain: KB staleness, open gap flags, overdue deadlines, and trend assessment.',
    inputSchema: {
      type: 'object',
      properties: {
        domainId: {
          type: 'string',
          description: 'The domain ID to assess.',
        },
      },
      required: ['domainId'],
    },
  },
]

// ── Executor ──

export function executeAdvisoryTool(
  db: Database.Database,
  toolName: string,
  input: Record<string, unknown>,
): string {
  try {
    switch (toolName) {
      case 'advisory_search_decisions':
        return execSearchDecisions(db, input)
      case 'advisory_search_deadlines':
        return execSearchDeadlines(db, input)
      case 'advisory_cross_domain_context':
        return execCrossDomainContext(db, input)
      case 'advisory_risk_snapshot':
        return execRiskSnapshot(db, input)
      default:
        return `ADVISORY_ERROR: Unknown tool ${toolName}`
    }
  } catch (e) {
    return `ADVISORY_ERROR: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ── Individual Executors ──

function execSearchDecisions(db: Database.Database, input: Record<string, unknown>): string {
  const domainId = typeof input.domainId === 'string' ? input.domainId : undefined
  const query = typeof input.query === 'string' ? input.query : undefined
  const status = typeof input.status === 'string' ? input.status : 'active'
  const limit = Math.min(typeof input.limit === 'number' ? input.limit : MAX_ITEMS, MAX_ITEMS)

  const conditions: string[] = []
  const params: unknown[] = []

  if (domainId) {
    conditions.push('d.domain_id = ?')
    params.push(domainId)
  }
  if (status) {
    conditions.push('d.status = ?')
    params.push(status)
  }
  if (query) {
    conditions.push('(d.decision LIKE ? OR d.rationale LIKE ?)')
    const pattern = `%${query}%`
    params.push(pattern, pattern)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(limit)

  const sql = `
    SELECT d.id, d.domain_id, d.decision_id, d.decision, d.rationale, d.downside,
           d.revisit_trigger, d.status, d.confidence, d.horizon, d.category,
           d.created_at, dom.name as domain_name
    FROM decisions d
    JOIN domains dom ON dom.id = d.domain_id
    ${where}
    ORDER BY d.created_at DESC
    LIMIT ?
  `

  interface DecisionRow {
    id: string; domain_id: string; decision_id: string; decision: string
    rationale: string; downside: string; revisit_trigger: string; status: string
    confidence: string | null; horizon: string | null; category: string | null
    created_at: string; domain_name: string
  }

  const rows = db.prepare(sql).all(...params) as DecisionRow[]

  const truncated = rows.length >= limit
  const results = rows.map((r) => ({
    domainId: r.domain_id,
    domainName: r.domain_name,
    decisionId: r.decision_id,
    decision: truncField(r.decision),
    rationale: truncField(r.rationale),
    downside: truncField(r.downside),
    revisitTrigger: truncField(r.revisit_trigger),
    status: r.status,
    confidence: r.confidence,
    horizon: r.horizon,
    category: r.category,
    createdAt: r.created_at,
  }))

  return JSON.stringify({ schemaVersion: 1, truncated, truncatedFields: [], results })
}

function execSearchDeadlines(db: Database.Database, input: Record<string, unknown>): string {
  const domainId = typeof input.domainId === 'string' ? input.domainId : undefined
  const daysAhead = typeof input.daysAhead === 'number' ? input.daysAhead : 30
  const priority = typeof input.priority === 'number' ? input.priority : undefined
  const includeOverdue = typeof input.includeOverdue === 'boolean' ? input.includeOverdue : true

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const futureDate = new Date(now.getTime() + daysAhead * 86_400_000)
  const futureStr = futureDate.toISOString().slice(0, 10)

  const conditions: string[] = ["dl.status IN ('active', 'snoozed')"]
  const params: unknown[] = []

  if (domainId) {
    conditions.push('dl.domain_id = ?')
    params.push(domainId)
  }
  if (priority !== undefined) {
    conditions.push('dl.priority <= ?')
    params.push(priority)
  }

  if (includeOverdue) {
    conditions.push('dl.due_date <= ?')
    params.push(futureStr)
  } else {
    conditions.push('dl.due_date >= ? AND dl.due_date <= ?')
    params.push(todayStr, futureStr)
  }

  const where = conditions.join(' AND ')
  params.push(MAX_ITEMS)

  const sql = `
    SELECT dl.id, dl.domain_id, dl.text, dl.due_date, dl.priority, dl.status,
           dl.source, dl.source_ref, dom.name as domain_name
    FROM deadlines dl
    JOIN domains dom ON dom.id = dl.domain_id
    WHERE ${where}
    ORDER BY dl.due_date ASC, dl.priority ASC
    LIMIT ?
  `

  interface DeadlineRow {
    id: string; domain_id: string; text: string; due_date: string; priority: number
    status: string; source: string; source_ref: string; domain_name: string
  }

  const rows = db.prepare(sql).all(...params) as DeadlineRow[]

  const results = rows.map((r) => {
    const dueDate = new Date(r.due_date + 'T00:00:00')
    const diffDays = Math.round((dueDate.getTime() - now.getTime()) / 86_400_000)

    return {
      domainId: r.domain_id,
      domainName: r.domain_name,
      id: r.id,
      text: truncField(r.text),
      dueDate: r.due_date,
      priority: r.priority,
      status: r.status,
      daysUntilDue: diffDays,
    }
  })

  return JSON.stringify({ schemaVersion: 1, truncated: rows.length >= MAX_ITEMS, truncatedFields: [], results })
}

function execCrossDomainContext(db: Database.Database, input: Record<string, unknown>): string {
  const domainId = typeof input.domainId === 'string' ? input.domainId : ''
  if (!domainId) return JSON.stringify({ schemaVersion: 1, truncated: false, error: 'domainId required' })

  // Get sibling relationships
  interface RelRow { sibling_domain_id: string }
  const siblings = db
    .prepare("SELECT sibling_domain_id FROM domain_relationships WHERE domain_id = ? AND relationship_type = 'sibling'")
    .all(domainId) as RelRow[]

  interface DomRow { id: string; name: string }

  const siblingResults = siblings.slice(0, MAX_ITEMS).map((rel) => {
    const dom = db.prepare('SELECT id, name FROM domains WHERE id = ?').get(rel.sibling_domain_id) as DomRow | undefined
    if (!dom) return null

    // Get health indicators for sibling
    const openGaps = (db.prepare("SELECT COUNT(*) as count FROM gap_flags WHERE domain_id = ? AND status = 'open'")
      .get(dom.id) as { count: number }).count

    const overdueDeadlines = (db.prepare(
      "SELECT COUNT(*) as count FROM deadlines WHERE domain_id = ? AND status = 'active' AND due_date < ?",
    ).get(dom.id, new Date().toISOString().slice(0, 10)) as { count: number }).count

    // Determine severity
    const severityScore = openGaps * 2 + overdueDeadlines * 3
    let status: string
    if (severityScore >= 10) status = 'blocked'
    else if (severityScore >= 5) status = 'stale-risk'
    else if (severityScore > 0) status = 'quiet'
    else status = 'active'

    // Recent decisions (last 5)
    interface DecRow { id: string; decision_id: string; decision: string; created_at: string }
    const recentDecisions = db
      .prepare("SELECT id, decision_id, decision, created_at FROM decisions WHERE domain_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 5")
      .all(dom.id) as DecRow[]

    return {
      sourceDomainId: dom.id,
      sourceDomainName: dom.name,
      health: {
        severityScore,
        status,
        openGapFlags: openGaps,
        overdueDeadlines,
      },
      recentDecisions: recentDecisions.map((d) => ({
        id: d.id,
        decisionId: d.decision_id,
        decision: truncField(d.decision),
        createdAt: d.created_at,
      })),
    }
  }).filter(Boolean)

  return JSON.stringify({
    schemaVersion: 1,
    truncated: siblings.length > MAX_ITEMS,
    truncatedFields: [],
    domainId,
    siblings: siblingResults,
  })
}

function execRiskSnapshot(db: Database.Database, input: Record<string, unknown>): string {
  const domainId = typeof input.domainId === 'string' ? input.domainId : ''
  if (!domainId) return JSON.stringify({ schemaVersion: 1, truncated: false, error: 'domainId required' })

  const todayStr = new Date().toISOString().slice(0, 10)

  // Gap flags
  const openGaps = (db.prepare("SELECT COUNT(*) as count FROM gap_flags WHERE domain_id = ? AND status = 'open'")
    .get(domainId) as { count: number }).count
  const acknowledgedGaps = (db.prepare("SELECT COUNT(*) as count FROM gap_flags WHERE domain_id = ? AND status = 'acknowledged'")
    .get(domainId) as { count: number }).count

  // Deadlines
  const overdueDeadlines = (db.prepare(
    "SELECT COUNT(*) as count FROM deadlines WHERE domain_id = ? AND status = 'active' AND due_date < ?",
  ).get(domainId, todayStr) as { count: number }).count
  const upcomingDeadlines = (db.prepare(
    "SELECT COUNT(*) as count FROM deadlines WHERE domain_id = ? AND status = 'active' AND due_date >= ? AND due_date <= ?",
  ).get(domainId, todayStr, new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)) as { count: number }).count

  // KB staleness (approximate via last_synced_at)
  interface KBRow { relative_path: string; tier: string; last_synced_at: string }
  const kbFiles = db.prepare('SELECT relative_path, tier, last_synced_at FROM kb_files WHERE domain_id = ?')
    .all(domainId) as KBRow[]

  const now = Date.now()
  let staleCount = 0
  let criticalCount = 0
  const staleThresholdDays = 14
  const criticalThresholdDays = 30

  for (const f of kbFiles) {
    const syncedAt = new Date(f.last_synced_at).getTime()
    const daysSince = Math.round((now - syncedAt) / 86_400_000)
    if (daysSince >= criticalThresholdDays) criticalCount++
    else if (daysSince >= staleThresholdDays) staleCount++
  }

  // Severity score
  const severityScore = openGaps * 2 + overdueDeadlines * 3 + criticalCount * 2 + staleCount

  // Trend: compare to recent activity
  // Simple heuristic: check gap flag creation rate in last 7 days vs previous 7 days
  const sevenDaysAgo = new Date(now - 7 * 86_400_000).toISOString()
  const fourteenDaysAgo = new Date(now - 14 * 86_400_000).toISOString()

  const recentGaps = (db.prepare(
    'SELECT COUNT(*) as count FROM gap_flags WHERE domain_id = ? AND created_at >= ?',
  ).get(domainId, sevenDaysAgo) as { count: number }).count
  const priorGaps = (db.prepare(
    'SELECT COUNT(*) as count FROM gap_flags WHERE domain_id = ? AND created_at >= ? AND created_at < ?',
  ).get(domainId, fourteenDaysAgo, sevenDaysAgo) as { count: number }).count

  let trend: string
  let trendConfidence: string

  if (recentGaps + priorGaps < 3) {
    trend = 'stable'
    trendConfidence = 'low'
  } else if (recentGaps > priorGaps + 2) {
    trend = 'worsening'
    trendConfidence = recentGaps + priorGaps >= 6 ? 'medium' : 'low'
  } else if (recentGaps < priorGaps - 2) {
    trend = 'improving'
    trendConfidence = recentGaps + priorGaps >= 6 ? 'medium' : 'low'
  } else {
    trend = 'stable'
    trendConfidence = recentGaps + priorGaps >= 6 ? 'medium' : 'low'
  }

  return JSON.stringify({
    schemaVersion: 1,
    truncated: false,
    truncatedFields: [],
    domainId,
    severityScore,
    breakdown: {
      openGapFlags: openGaps,
      acknowledgedGapFlags: acknowledgedGaps,
      overdueDeadlines,
      upcomingDeadlines7d: upcomingDeadlines,
      kbFiles: kbFiles.length,
      staleKbFiles: staleCount,
      criticalKbFiles: criticalCount,
    },
    trend,
    trendConfidence,
  })
}
