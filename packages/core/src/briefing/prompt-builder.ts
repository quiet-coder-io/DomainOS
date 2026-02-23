/**
 * Assembles the system prompt for the briefing LLM analysis.
 *
 * Pure function — no filesystem I/O. Receives pre-loaded data,
 * projects health into a stable schema, and assembles the prompt
 * with deterministic token-budget compression.
 */

import { estimateTokens } from '../agents/token-budgets.js'
import type { PortfolioHealth, DomainHealth, DomainStatus, CrossDomainAlert } from './portfolio-health.js'

// ── Public types ──

export interface BriefingPromptContext {
  health: PortfolioHealth
  digests: Array<{ domainId: string; domainName: string; content: string }>
  currentDate: string
  globalOverdueGTasks?: number
}

// ── Projected type for LLM consumption (versioned, stable) ──

export interface ProjectedHealthV1 {
  domains: Array<{
    domainId: string
    domainName: string
    status: DomainStatus
    severityScore: number
    staleSummary: {
      fresh: number
      stale: number
      critical: number
      criticalByTier: Record<string, number>
    }
    openGapFlags: number
    outgoingDeps: Array<{ targetDomainId: string; dependencyType: string; description: string }>
    incomingDeps: Array<{ sourceDomainId: string; dependencyType: string; description: string }>
  }>
  alerts: Array<{
    sourceDomainId: string
    dependentDomainId: string
    severity: string
    text: string
    dependentStatus: DomainStatus
    dependentOpenGaps: number
  }>
}

// ── Constants ──

const TOKEN_BUDGET = 48_000
const MAX_DIGEST_CHARS = 6_000
const MIN_CHARS_PER_DOMAIN = 500
const HARD_FLOOR_CHARS = 2_000
const DESC_CAP = 80

// ── Redaction hook (no-op initially) ──

export function redactForLLM(text: string): string {
  return text
}

// ── Projection ──

export function projectPortfolioHealthForLLM(health: PortfolioHealth): ProjectedHealthV1 {
  const domains = health.domains
    .slice()
    .sort((a, b) => a.domainId.localeCompare(b.domainId))
    .map((d) => ({
      domainId: d.domainId,
      domainName: d.domainName,
      status: d.status,
      severityScore: d.severityScore,
      staleSummary: {
        fresh: d.staleSummary.fresh,
        stale: d.staleSummary.stale,
        critical: d.staleSummary.critical,
        criticalByTier: { ...d.staleSummary.criticalByTier },
      },
      openGapFlags: d.openGapFlags,
      outgoingDeps: d.outgoingDeps.map((dep) => ({
        targetDomainId: dep.targetDomainId,
        dependencyType: dep.dependencyType,
        description: dep.description.slice(0, DESC_CAP),
      })),
      incomingDeps: d.incomingDeps.map((dep) => ({
        sourceDomainId: dep.sourceDomainId,
        dependencyType: dep.dependencyType,
        description: dep.description.slice(0, DESC_CAP),
      })),
    }))

  const alerts = health.alerts.map((a) => ({
    sourceDomainId: a.sourceDomainId,
    dependentDomainId: a.dependentDomainId,
    severity: a.severity,
    text: a.text,
    dependentStatus: a.dependentStatus,
    dependentOpenGaps: a.dependentOpenGaps,
  }))

  return { domains, alerts }
}

// ── Prompt assembly ──

/**
 * Build the system prompt for briefing analysis.
 * Deterministic: same inputs produce same output.
 */
export function buildBriefingPrompt(context: BriefingPromptContext): string {
  const { health, currentDate } = context

  // Sort digests by domainId for deterministic ordering
  const sortedDigests = context.digests
    .slice()
    .sort((a, b) => a.domainId.localeCompare(b.domainId))

  // Apply redaction and initial cap
  const processedDigests = sortedDigests.map((d) => ({
    ...d,
    content: d.content === '(kb_digest.md missing)'
      ? d.content
      : redactForLLM(d.content).slice(0, MAX_DIGEST_CHARS),
  }))

  // Build static sections
  const projected = projectPortfolioHealthForLLM(health)
  const groundTruthJSON = JSON.stringify(projected, null, 2)

  const gtasksLine = context.globalOverdueGTasks != null && context.globalOverdueGTasks > 0
    ? `\nGlobal: ${context.globalOverdueGTasks} overdue Google Tasks (not domain-scoped)\n`
    : ''

  const dateSection = `=== CURRENT DATE ===\n${currentDate}\n${gtasksLine}`
  const jsonSection = `=== GROUND TRUTH JSON (ProjectedHealth v1) ===\n${groundTruthJSON}\n`
  const alertsSection = buildComputedAlertsSection(health.alerts)
  const relationshipsSection = buildRelationshipsSection(health.domains)
  const outputFormatSection = buildOutputFormatSection()
  const constraintsSection = buildConstraintsSection()

  // Build digest headers for overhead measurement
  const digestHeaders = processedDigests.map(
    (d) => `--- ${d.domainName} (${d.domainId}) ---`,
  )

  // Measure overhead: everything except digest content
  const staticParts = [dateSection, jsonSection, alertsSection, relationshipsSection, outputFormatSection, constraintsSection]
  const staticChars = staticParts.reduce((s, p) => s + p.length, 0)
  const sectionHeader = '=== KB DIGEST EXCERPTS (human notes — may be stale) ===\n'
  const sectionNote = '\nNote: Digests sorted by domainId for deterministic ordering. Domain id included in header for model alignment.\nQuiet domains with status === \'quiet\' are dropped first during compression (header kept, content replaced with placeholder).\n'
  const headersChars = digestHeaders.reduce((sum, h) => sum + h.length + 1, 0) // +1 for newline
  const fixedChars = staticChars + sectionHeader.length + sectionNote.length + headersChars

  // Compress digests to fit token budget
  const compressedDigests = compressDigests(processedDigests, health.domains, fixedChars)

  // Build digest section
  const digestSection = buildDigestSection(compressedDigests, digestHeaders, sectionHeader, sectionNote)

  return [
    dateSection,
    jsonSection,
    alertsSection,
    relationshipsSection,
    digestSection,
    outputFormatSection,
    constraintsSection,
  ].join('\n')
}

// ── Computed alerts section ──

function buildComputedAlertsSection(alerts: CrossDomainAlert[]): string {
  if (alerts.length === 0) return '=== COMPUTED ALERTS (do not dismiss or downgrade) ===\n(none)\n'

  const lines = alerts.map(
    (a) => `- ${a.severity.toUpperCase()}: ${a.sourceDomainName} \u2192 ${a.dependentDomainName}: ${a.text}`,
  )
  return `=== COMPUTED ALERTS (do not dismiss or downgrade) ===\n${lines.join('\n')}\n`
}

// ── Relationships section ──

function buildRelationshipsSection(domains: DomainHealth[]): string {
  const rows: string[] = []

  for (const d of domains) {
    for (const dep of d.outgoingDeps) {
      rows.push(
        `| ${d.domainName} (${d.domainId}) | \u2192 | ${dep.targetDomainName} (${dep.targetDomainId}) | ${dep.dependencyType} | ${dep.description.slice(0, DESC_CAP)} |`,
      )
    }
  }

  if (rows.length === 0) return '=== RELATIONSHIPS (authoritative) ===\n(none)\n'

  const header = '| Source (id) | \u2192 | Target (id) | Type | Description |'
  return `=== RELATIONSHIPS (authoritative) ===\n${header}\n${rows.join('\n')}\n`
}

// ── Digest compression ──

interface ProcessedDigest {
  domainId: string
  domainName: string
  content: string
}

function compressDigests(
  digests: ProcessedDigest[],
  domains: DomainHealth[],
  fixedChars: number,
): ProcessedDigest[] {
  const totalBudgetChars = TOKEN_BUDGET * 4 // reverse estimateTokens
  const availableChars = totalBudgetChars - fixedChars

  const statusByDomainId = new Map(domains.map((d) => [d.domainId, d.status]))

  // Step 1: already capped at MAX_DIGEST_CHARS — check if we fit
  let result = digests.map((d) => ({ ...d }))
  if (fitsInBudget(result, fixedChars)) return result

  // Step 2: proportional truncation with floor
  result = proportionalTruncate(result, availableChars)
  if (fitsInBudget(result, fixedChars)) return result

  // Step 3: drop quiet domain digests
  result = result.map((d) => {
    if (statusByDomainId.get(d.domainId) === 'quiet' && d.content !== '(kb_digest.md missing)') {
      return { ...d, content: '(quiet domain \u2014 digest omitted for token budget)' }
    }
    return d
  })
  if (fitsInBudget(result, fixedChars)) return result

  // Step 4: hard floor truncation
  result = result.map((d) => {
    if (d.content === '(kb_digest.md missing)' || d.content === '(quiet domain \u2014 digest omitted for token budget)') {
      return d
    }
    return { ...d, content: d.content.slice(0, HARD_FLOOR_CHARS) }
  })

  return result
}

function fitsInBudget(digests: ProcessedDigest[], fixedChars: number): boolean {
  const digestChars = digests.reduce((sum, d) => sum + d.content.length, 0)
  return estimateTokens(fixedChars + digestChars) <= TOKEN_BUDGET
}

/**
 * Deterministic proportional truncation.
 */
function proportionalTruncate(
  digests: ProcessedDigest[],
  availableChars: number,
): ProcessedDigest[] {
  const passthrough: ProcessedDigest[] = []
  const truncatable: ProcessedDigest[] = []

  for (const d of digests) {
    if (d.content === '(kb_digest.md missing)') {
      passthrough.push(d)
    } else {
      truncatable.push(d)
    }
  }

  const passthroughChars = passthrough.reduce((s, d) => s + d.content.length, 0)
  const budgetForTruncatable = Math.max(0, availableChars - passthroughChars)

  if (truncatable.length === 0) return digests

  const sumLen = truncatable.reduce((s, d) => s + d.content.length, 0)
  if (sumLen <= budgetForTruncatable) return digests

  // Compute proportional targets
  const targets = truncatable.map((d) => {
    const raw = Math.floor(budgetForTruncatable * (d.content.length / sumLen))
    return Math.max(MIN_CHARS_PER_DOMAIN, Math.min(raw, d.content.length))
  })

  // Distribute remainder in domainId-sorted order
  const used = targets.reduce((s, t) => s + t, 0)
  let remainder = Math.max(0, budgetForTruncatable - used)

  const sortedIndices = truncatable
    .map((_, i) => i)
    .sort((a, b) => truncatable[a].domainId.localeCompare(truncatable[b].domainId))

  for (const idx of sortedIndices) {
    if (remainder <= 0) break
    const canAdd = truncatable[idx].content.length - targets[idx]
    if (canAdd > 0) {
      const add = Math.min(1, canAdd, remainder)
      targets[idx] += add
      remainder -= add
    }
  }

  // Apply truncation
  const truncatedMap = new Map<string, string>()
  truncatable.forEach((d, i) => {
    truncatedMap.set(d.domainId, d.content.slice(0, targets[i]))
  })

  return digests.map((d) => {
    const truncated = truncatedMap.get(d.domainId)
    if (truncated !== undefined) return { ...d, content: truncated }
    return d
  })
}

// ── Digest section builder ──

function buildDigestSection(
  digests: ProcessedDigest[],
  headers: string[],
  sectionHeader: string,
  sectionNote: string,
): string {
  const lines = [sectionHeader.trimEnd()]

  digests.forEach((d, i) => {
    lines.push(headers[i])
    lines.push(d.content)
  })

  lines.push(sectionNote.trimEnd())

  return lines.join('\n') + '\n'
}

// ── Output format section ──

function buildOutputFormatSection(): string {
  return `=== OUTPUT FORMAT ===

\`\`\`briefing-alert
domain: <domainName>
severity: critical | warning | monitor
text: <what is wrong and why it matters>
evidence: <specific file, tier, staleness, or dependency>
\`\`\`

\`\`\`briefing-action
domain: <domainName>
priority: <1-7, where 1 is most urgent>
deadline: <YYYY-MM-DD or omit if no specific deadline>
text: <specific action to take>
\`\`\`

\`\`\`briefing-monitor
domain: <domainName>
text: <what to watch and why>
\`\`\`
`
}

// ── Constraints section ──

function buildConstraintsSection(): string {
  return `=== CONSTRAINTS ===
- Do not invent relationships not in RELATIONSHIPS.
- Do not dismiss or downgrade computed alerts.
- Do not claim a domain is healthy if status is blocked or stale-risk.
- Computed DomainStatus and severityScore are ground truth.
- You may add context, suggest actions, or identify patterns the computed layer cannot.
- In blocks, set \`domain:\` to the domainName exactly as shown in GROUND TRUTH.
- Do not include \`\`\` inside any briefing-* block.
- Return only briefing-* blocks. No prose outside blocks.
- If you need to quote text containing backticks, replace them with single quotes.
`
}
