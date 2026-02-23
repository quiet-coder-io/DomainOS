/**
 * Portfolio health computation — deterministic ground-truth layer.
 *
 * Computes per-domain health metrics, cross-domain alerts, and snapshot hash.
 * All severity scores and status derivations are deterministic and reproducible.
 */

import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { KBTier } from '../kb/tiers.js'
import { calculateStaleness, STALENESS_THRESHOLDS } from '../kb/staleness.js'
import type { StalenessLevel } from '../kb/staleness.js'
import type { DependencyType, DomainRelationship } from '../domains/relationships.js'
import { DomainRelationshipRepository } from '../domains/relationships.js'
import { DomainRepository } from '../domains/repository.js'
import { KBRepository } from '../kb/repository.js'
import { GapFlagRepository } from '../agents/gap-flag-repository.js'
import { DeadlineRepository } from '../deadlines/repository.js'
import { todayISO, deadlineSeverityWeight } from '../deadlines/evaluation.js'
import type { Deadline } from '../deadlines/schemas.js'
import type { Result } from '../common/index.js'
import { Ok, Err, DomainOSError } from '../common/index.js'

// ── Types ──

export type DomainStatus = 'active' | 'quiet' | 'stale-risk' | 'blocked'

export interface StaleSummary {
  freshByTier: Record<KBTier, number>
  staleByTier: Record<KBTier, number>
  criticalByTier: Record<KBTier, number>
  fresh: number
  stale: number
  critical: number
  worstFile?: { path: string; tier: string; daysSinceUpdate: number }
}

export interface DomainHealth {
  domainId: string
  domainName: string
  status: DomainStatus
  fileCountTotal: number
  fileCountStatChecked: number
  staleSummary: StaleSummary
  openGapFlags: number
  overdueDeadlines: number
  severityScore: number
  lastTouchedAt: string | null
  outgoingDeps: Array<{
    targetDomainId: string
    targetDomainName: string
    dependencyType: DependencyType
    description: string
  }>
  incomingDeps: Array<{
    sourceDomainId: string
    sourceDomainName: string
    dependencyType: DependencyType
    description: string
  }>
}

export interface CrossDomainAlert {
  severity: 'critical' | 'warning' | 'monitor'
  sourceDomainId: string
  sourceDomainName: string
  dependentDomainId: string
  dependentDomainName: string
  dependentStatus: DomainStatus
  dependentOpenGaps: number
  text: string
  trace: {
    triggerFile?: string
    triggerTier?: string
    triggerStaleness?: number
    dependencyType: DependencyType
    description: string
    baseSeverityScore: number
    escalated: boolean
  }
}

export interface PortfolioHealth {
  domains: DomainHealth[]
  alerts: CrossDomainAlert[]
  computedAt: string
  snapshotHash: string
}

// ── Scoring constants ──

const TIER_MULTIPLIER: Record<KBTier, number> = {
  structural: 2,
  status: 4,
  intelligence: 3,
  general: 1,
}

const LEVEL_MULTIPLIER: Record<StalenessLevel, number> = {
  fresh: 0,
  stale: 1,
  critical: 3,
}

const GAP_FLAG_WEIGHT = 2

/** Tiers worth stat'ing for severity scoring (skip general for perf). */
const SCORED_TIERS: Set<KBTier> = new Set(['structural', 'status', 'intelligence'])

const MS_PER_DAY = 86_400_000
const QUIET_THRESHOLD_DAYS = 14
const STAT_CONCURRENCY = 16

// ── Severity thresholds ──

type AlertSeverity = 'critical' | 'warning' | 'monitor'

function severityFromScore(score: number): AlertSeverity {
  if (score >= 7) return 'critical'
  if (score >= 3) return 'warning'
  return 'monitor'
}

function escalateSeverity(base: AlertSeverity): AlertSeverity {
  if (base === 'monitor') return 'warning'
  // warning and critical both escalate to critical
  return 'critical'
}

// ── File weight ──

export function fileWeight(tier: KBTier, level: StalenessLevel): number {
  return TIER_MULTIPLIER[tier] * LEVEL_MULTIPLIER[level]
}

// ── Structural block detection ──

export function hasStructuralBlock(staleSummary: StaleSummary): boolean {
  return (
    (staleSummary.criticalByTier.status ?? 0) > 0 ||
    (staleSummary.criticalByTier.structural ?? 0) > 0
  )
}

// ── Batch stat helper ──

interface FileStatResult {
  relativePath: string
  tier: KBTier
  mtimeMs: number
}

async function batchStat(
  files: Array<{ relativePath: string; absolutePath: string; tier: KBTier }>,
  concurrency: number,
): Promise<{ results: FileStatResult[]; maxInFlight: number }> {
  const results: FileStatResult[] = []
  let inFlight = 0
  let maxInFlight = 0

  // Process in chunks of `concurrency`
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency)
    inFlight += chunk.length
    if (inFlight > maxInFlight) maxInFlight = inFlight

    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        try {
          const s = await stat(file.absolutePath)
          return { relativePath: file.relativePath, tier: file.tier, mtimeMs: s.mtimeMs }
        } catch {
          return null
        }
      }),
    )

    inFlight -= chunk.length

    for (const r of chunkResults) {
      if (r) results.push(r)
    }
  }

  return { results, maxInFlight }
}

// ── Empty tier record helper ──

function emptyTierRecord(): Record<KBTier, number> {
  return { structural: 0, status: 0, intelligence: 0, general: 0 }
}

// ── Main computation ──

export async function computePortfolioHealth(
  db: Database.Database,
): Promise<Result<PortfolioHealth, DomainOSError>> {
  try {
    const domainRepo = new DomainRepository(db)
    const kbRepo = new KBRepository(db)
    const gapRepo = new GapFlagRepository(db)
    const relRepo = new DomainRelationshipRepository(db)
    const deadlineRepo = new DeadlineRepository(db)

    // Freeze "today" for consistent overdue evaluation across the computation
    const today = todayISO()

    // 1. Load all domains
    const domainsResult = domainRepo.list()
    if (!domainsResult.ok) return Err(domainsResult.error)
    const domains = domainsResult.value

    // 2. Load all relationships once
    const allRelsResult = relRepo.getAll()
    if (!allRelsResult.ok) return Err(allRelsResult.error)
    const allRels = allRelsResult.value

    // Build domain name map
    const domainNameMap = new Map(domains.map((d) => [d.id, d.name]))

    // Index relationships by source and target
    const outgoingByDomain = new Map<string, DomainRelationship[]>()
    const incomingByDomain = new Map<string, DomainRelationship[]>()
    for (const rel of allRels) {
      if (!outgoingByDomain.has(rel.domainId)) outgoingByDomain.set(rel.domainId, [])
      outgoingByDomain.get(rel.domainId)!.push(rel)
      if (!incomingByDomain.has(rel.siblingDomainId)) incomingByDomain.set(rel.siblingDomainId, [])
      incomingByDomain.get(rel.siblingDomainId)!.push(rel)
    }

    // 2b. Load all overdue deadlines once, group by domain
    const overdueByDomain = new Map<string, Deadline[]>()
    const overdueResult = deadlineRepo.getOverdue(undefined, today)
    if (overdueResult.ok) {
      for (const d of overdueResult.value) {
        if (!overdueByDomain.has(d.domainId)) overdueByDomain.set(d.domainId, [])
        overdueByDomain.get(d.domainId)!.push(d)
      }
    }

    // 3. Compute per-domain health
    const domainHealths: DomainHealth[] = []

    for (const domain of domains) {
      // Get KB files
      const filesResult = kbRepo.getFiles(domain.id)
      if (!filesResult.ok) continue
      const allFiles = filesResult.value

      // Get open gap flags
      const gapsResult = gapRepo.getOpen(domain.id)
      const openGaps = gapsResult.ok ? gapsResult.value : []

      // Get all gap flags for lastTouchedAt
      const allGapsResult = gapRepo.getByDomain(domain.id)
      const allGaps = allGapsResult.ok ? allGapsResult.value : []

      // Determine files to stat (scored tiers only for perf)
      const scoredFiles = allFiles
        .filter((f) => SCORED_TIERS.has(f.tier as KBTier))
        .map((f) => ({
          relativePath: f.relativePath,
          absolutePath: join(domain.kbPath, f.relativePath),
          tier: f.tier as KBTier,
        }))

      // Batch stat for scored tiers
      const { results: statResults } = await batchStat(scoredFiles, STAT_CONCURRENCY)

      // Build staleness summary
      const freshByTier = emptyTierRecord()
      const staleByTier = emptyTierRecord()
      const criticalByTier = emptyTierRecord()

      let worstFile: StaleSummary['worstFile'] = undefined
      let worstFileScore = -1
      let newestMtimeMs = 0
      let severityScore = 0

      for (const sr of statResults) {
        const staleness = calculateStaleness(sr.mtimeMs, undefined, sr.tier)

        if (staleness.level === 'fresh') freshByTier[sr.tier]++
        else if (staleness.level === 'stale') staleByTier[sr.tier]++
        else if (staleness.level === 'critical') criticalByTier[sr.tier]++

        const weight = fileWeight(sr.tier, staleness.level)
        severityScore += weight

        // Track worst file by tier priority, then days
        const fileScore = TIER_MULTIPLIER[sr.tier] * 1000 + staleness.daysSinceUpdate
        if (staleness.level !== 'fresh' && fileScore > worstFileScore) {
          worstFileScore = fileScore
          worstFile = {
            path: sr.relativePath,
            tier: sr.tier,
            daysSinceUpdate: staleness.daysSinceUpdate,
          }
        }

        if (sr.mtimeMs > newestMtimeMs) newestMtimeMs = sr.mtimeMs
      }

      // Add gap flag weight
      severityScore += openGaps.length * GAP_FLAG_WEIGHT

      // Add overdue deadline weight (capped at 12)
      const domainOverdue = overdueByDomain.get(domain.id) ?? []
      let deadlineSeverity = 0
      for (const dl of domainOverdue) {
        deadlineSeverity += deadlineSeverityWeight(dl, today)
      }
      severityScore += Math.min(deadlineSeverity, 12)

      // Derive aggregates
      const fresh = Object.values(freshByTier).reduce((a, b) => a + b, 0)
      const stale = Object.values(staleByTier).reduce((a, b) => a + b, 0)
      const critical = Object.values(criticalByTier).reduce((a, b) => a + b, 0)

      // Derive lastTouchedAt
      let lastTouchedMs = newestMtimeMs

      for (const gap of allGaps) {
        const createdMs = new Date(gap.createdAt).getTime()
        if (createdMs > lastTouchedMs) lastTouchedMs = createdMs
        if (gap.resolvedAt) {
          const resolvedMs = new Date(gap.resolvedAt).getTime()
          if (resolvedMs > lastTouchedMs) lastTouchedMs = resolvedMs
        }
      }

      const lastTouchedAt = lastTouchedMs > 0 ? new Date(lastTouchedMs).toISOString() : null

      // Build dependency lists
      const outgoing = (outgoingByDomain.get(domain.id) ?? []).map((r) => ({
        targetDomainId: r.siblingDomainId,
        targetDomainName: domainNameMap.get(r.siblingDomainId) ?? 'Unknown',
        dependencyType: r.dependencyType,
        description: r.description,
      }))

      const incoming = (incomingByDomain.get(domain.id) ?? []).map((r) => ({
        sourceDomainId: r.domainId,
        sourceDomainName: domainNameMap.get(r.domainId) ?? 'Unknown',
        dependencyType: r.dependencyType,
        description: r.description,
      }))

      domainHealths.push({
        domainId: domain.id,
        domainName: domain.name,
        status: 'active', // placeholder — derived below after all domains computed
        fileCountTotal: allFiles.length,
        fileCountStatChecked: statResults.length,
        staleSummary: {
          freshByTier,
          staleByTier,
          criticalByTier,
          fresh,
          stale,
          critical,
          worstFile,
        },
        openGapFlags: openGaps.length,
        overdueDeadlines: domainOverdue.length,
        severityScore,
        lastTouchedAt,
        outgoingDeps: outgoing,
        incomingDeps: incoming,
      })
    }

    // 4. Derive domain statuses (needs cross-domain context)
    const healthById = new Map(domainHealths.map((h) => [h.domainId, h]))

    for (const dh of domainHealths) {
      dh.status = deriveDomainStatus(dh, healthById)
    }

    // 5. Generate cross-domain alerts
    const alerts = generateCrossDomainAlerts(domainHealths, healthById)

    // 6. Compute snapshot hash
    const snapshotHash = computeSnapshotHash(domainHealths)

    return Ok({
      domains: domainHealths,
      alerts,
      computedAt: new Date().toISOString(),
      snapshotHash,
    })
  } catch (e) {
    return Err(DomainOSError.db(`Portfolio health computation failed: ${(e as Error).message}`))
  }
}

// ── Domain status derivation ──

function deriveDomainStatus(
  dh: DomainHealth,
  healthById: Map<string, DomainHealth>,
): DomainStatus {
  const hardDepTypes: Set<string> = new Set(['blocks', 'depends_on'])

  // blocked: incoming hard dep from a structurally-stale source
  const hasBlockingSource = dh.incomingDeps.some((dep) => {
    if (!hardDepTypes.has(dep.dependencyType)) return false
    const sourceHealth = healthById.get(dep.sourceDomainId)
    return sourceHealth ? hasStructuralBlock(sourceHealth.staleSummary) : false
  })

  if (hasBlockingSource) return 'blocked'

  // stale-risk: this domain is stale AND something depends on it
  const hasHardDependents = dh.outgoingDeps.some((dep) => hardDepTypes.has(dep.dependencyType))
  if (dh.severityScore >= 3 && hasHardDependents) return 'stale-risk'

  // quiet: score=0, no hard dependents, untouched for >14 days
  if (
    dh.severityScore === 0 &&
    !hasHardDependents &&
    dh.lastTouchedAt !== null
  ) {
    const daysSinceTouch = Math.floor(
      (Date.now() - new Date(dh.lastTouchedAt).getTime()) / MS_PER_DAY,
    )
    if (daysSinceTouch > QUIET_THRESHOLD_DAYS) return 'quiet'
  }

  // quiet: no files at all
  if (dh.fileCountTotal === 0 && dh.severityScore === 0) return 'quiet'

  // quiet: has files but no scored-tier activity (missing core KB structure)
  if (dh.fileCountTotal > 0 && dh.lastTouchedAt === null && dh.severityScore === 0) return 'quiet'

  return 'active'
}

// ── Cross-domain alert generation ──

function generateCrossDomainAlerts(
  domainHealths: DomainHealth[],
  healthById: Map<string, DomainHealth>,
): CrossDomainAlert[] {
  const alerts: CrossDomainAlert[] = []
  const alertGeneratingTypes: Set<string> = new Set(['blocks', 'depends_on'])

  for (const source of domainHealths) {
    if (source.severityScore === 0) continue

    for (const outDep of source.outgoingDeps) {
      if (!alertGeneratingTypes.has(outDep.dependencyType)) continue

      const dependent = healthById.get(outDep.targetDomainId)
      if (!dependent) continue

      const baseSeverity = severityFromScore(source.severityScore)
      const escalated = outDep.dependencyType === 'blocks'
      const finalSeverity = escalated ? escalateSeverity(baseSeverity) : baseSeverity

      const worst = source.staleSummary.worstFile
      const text = buildAlertText(source, dependent, outDep, worst)

      alerts.push({
        severity: finalSeverity,
        sourceDomainId: source.domainId,
        sourceDomainName: source.domainName,
        dependentDomainId: dependent.domainId,
        dependentDomainName: dependent.domainName,
        dependentStatus: dependent.status,
        dependentOpenGaps: dependent.openGapFlags,
        text,
        trace: {
          triggerFile: worst?.path,
          triggerTier: worst?.tier,
          triggerStaleness: worst?.daysSinceUpdate,
          dependencyType: outDep.dependencyType,
          description: outDep.description,
          baseSeverityScore: source.severityScore,
          escalated,
        },
      })
    }
  }

  // Sort: critical first, then warning, then monitor
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, monitor: 2 }
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return alerts
}

function buildAlertText(
  source: DomainHealth,
  dependent: DomainHealth,
  dep: { dependencyType: DependencyType; description: string },
  worst?: StaleSummary['worstFile'],
): string {
  const parts: string[] = []

  if (worst) {
    parts.push(
      `${source.domainName} ${worst.path} ${worst.daysSinceUpdate}d stale (${worst.tier} tier)`,
    )
  } else {
    parts.push(`${source.domainName} severity score: ${source.severityScore}`)
  }

  const verb = dep.dependencyType === 'blocks' ? 'Blocks' : 'Depended on by'
  const descPart = dep.description ? `: '${dep.description}'` : ''
  parts.push(`${verb} ${dependent.domainName}${descPart}`)

  if (dependent.openGapFlags > 0) {
    parts.push(`${dependent.domainName} has ${dependent.openGapFlags} open gap${dependent.openGapFlags > 1 ? 's' : ''}`)
  }

  return parts.join('. ') + '.'
}

// ── Snapshot hash ──

export function computeSnapshotHash(domainHealths: DomainHealth[]): string {
  const sorted = domainHealths
    .slice()
    .sort((a, b) => a.domainId.localeCompare(b.domainId))
    .map((d) => ({
      id: d.domainId,
      staleSummary: d.staleSummary,
      openGapFlags: d.openGapFlags,
      overdueDeadlines: d.overdueDeadlines,
      outgoingDeps: d.outgoingDeps
        .slice()
        .sort(
          (a, b) =>
            a.targetDomainId.localeCompare(b.targetDomainId) ||
            a.dependencyType.localeCompare(b.dependencyType),
        )
        .map((r) => ({ target: r.targetDomainId, type: r.dependencyType })),
      incomingDeps: d.incomingDeps
        .slice()
        .sort(
          (a, b) =>
            a.sourceDomainId.localeCompare(b.sourceDomainId) ||
            a.dependencyType.localeCompare(b.dependencyType),
        )
        .map((r) => ({ source: r.sourceDomainId, type: r.dependencyType })),
    }))

  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}
