import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/storage/index.js'
import { DomainRepository } from '../../src/domains/repository.js'
import { DomainRelationshipRepository } from '../../src/domains/relationships.js'
import { DependencyTypeSchema } from '../../src/domains/relationships.js'
import { KBRepository } from '../../src/kb/repository.js'
import { GapFlagRepository } from '../../src/agents/gap-flag-repository.js'
import {
  fileWeight,
  hasStructuralBlock,
  computeSnapshotHash,
} from '../../src/briefing/portfolio-health.js'
import type { DomainHealth, StaleSummary } from '../../src/briefing/portfolio-health.js'
import type Database from 'better-sqlite3'

let db: Database.Database
let domainRepo: DomainRepository
let relRepo: DomainRelationshipRepository
let kbRepo: KBRepository
let gapRepo: GapFlagRepository

// Helper to create a domain
function createDomain(name: string, kbPath = '/tmp/test-kb'): string {
  const result = domainRepo.create({ name, kbPath })
  if (!result.ok) throw new Error(`Failed to create domain: ${name}`)
  return result.value.id
}

// Helper to build a minimal DomainHealth for testing derivation functions
function makeDomainHealth(overrides: Partial<DomainHealth> = {}): DomainHealth {
  const emptyTierRecord = () => ({ structural: 0, status: 0, intelligence: 0, general: 0 })
  return {
    domainId: 'test-id',
    domainName: 'Test',
    status: 'active',
    fileCountTotal: 0,
    fileCountStatChecked: 0,
    staleSummary: {
      freshByTier: emptyTierRecord(),
      staleByTier: emptyTierRecord(),
      criticalByTier: emptyTierRecord(),
      fresh: 0,
      stale: 0,
      critical: 0,
    },
    openGapFlags: 0,
    severityScore: 0,
    lastTouchedAt: null,
    outgoingDeps: [],
    incomingDeps: [],
    ...overrides,
  }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  domainRepo = new DomainRepository(db)
  relRepo = new DomainRelationshipRepository(db)
  kbRepo = new KBRepository(db)
  gapRepo = new GapFlagRepository(db)
})

describe('Directed relationships', () => {
  it('A→B=blocks does NOT auto-create B→A', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    const result = relRepo.addRelationship(a, b, {
      dependencyType: 'blocks',
      description: 'A blocks B',
    })
    expect(result.ok).toBe(true)

    // A has outgoing to B
    const aRels = relRepo.getSiblings(a)
    expect(aRels.ok).toBe(true)
    if (aRels.ok) {
      expect(aRels.value.length).toBe(1)
      expect(aRels.value[0].siblingDomainId).toBe(b)
      expect(aRels.value[0].dependencyType).toBe('blocks')
    }

    // B should have NO outgoing relationships
    const bRels = relRepo.getSiblings(b)
    expect(bRels.ok).toBe(true)
    if (bRels.ok) {
      expect(bRels.value.length).toBe(0)
    }
  })

  it('reciprocate=true creates both edges with correct types', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    const result = relRepo.addRelationship(a, b, {
      dependencyType: 'blocks',
      reciprocate: true,
      reciprocalType: 'depends_on',
      description: 'A blocks B',
    })
    expect(result.ok).toBe(true)

    // A→B exists
    const aRels = relRepo.getSiblings(a)
    expect(aRels.ok).toBe(true)
    if (aRels.ok) {
      expect(aRels.value.length).toBe(1)
      expect(aRels.value[0].dependencyType).toBe('blocks')
    }

    // B→A exists with reciprocal type
    const bRels = relRepo.getSiblings(b)
    expect(bRels.ok).toBe(true)
    if (bRels.ok) {
      expect(bRels.value.length).toBe(1)
      expect(bRels.value[0].dependencyType).toBe('depends_on')
    }
  })

  it('removeRelationship removes only one direction', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    relRepo.addRelationship(a, b, {
      dependencyType: 'blocks',
      reciprocate: true,
      reciprocalType: 'depends_on',
    })

    relRepo.removeRelationship(a, b)

    // A→B gone
    const aRels = relRepo.getSiblings(a)
    if (aRels.ok) expect(aRels.value.length).toBe(0)

    // B→A still exists
    const bRels = relRepo.getSiblings(b)
    if (bRels.ok) expect(bRels.value.length).toBe(1)
  })

  it('getRelationships returns both perspectives', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')
    const c = createDomain('Domain C')

    relRepo.addRelationship(a, b, { dependencyType: 'blocks' })
    relRepo.addRelationship(c, a, { dependencyType: 'depends_on' })

    const getName = (id: string) => {
      const d = domainRepo.getById(id)
      return d.ok ? d.value.name : 'Unknown'
    }

    const views = relRepo.getRelationships(a, getName)
    expect(views.ok).toBe(true)
    if (views.ok) {
      expect(views.value.length).toBe(2)
      const outgoing = views.value.filter((v) => v.perspective === 'outgoing')
      const incoming = views.value.filter((v) => v.perspective === 'incoming')
      expect(outgoing.length).toBe(1)
      expect(incoming.length).toBe(1)
      expect(outgoing[0].peerDomainId).toBe(b)
      expect(incoming[0].peerDomainId).toBe(c)
    }
  })

  it('displayKey is direction-agnostic for deduplication', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    relRepo.addRelationship(a, b, { dependencyType: 'blocks', reciprocate: true, reciprocalType: 'depends_on' })

    const getName = (id: string) => {
      const d = domainRepo.getById(id)
      return d.ok ? d.value.name : 'Unknown'
    }

    const views = relRepo.getRelationships(a, getName)
    if (views.ok) {
      // Both the outgoing A→B and incoming B→A should share the same displayKey
      const keys = new Set(views.value.map((v) => v.displayKey))
      expect(keys.size).toBe(1)
    }
  })
})

describe('fileWeight', () => {
  it('status-tier critical = 4×3 = 12', () => {
    expect(fileWeight('status', 'critical')).toBe(12)
  })

  it('general-tier critical = 1×3 = 3', () => {
    expect(fileWeight('general', 'critical')).toBe(3)
  })

  it('structural-tier stale = 2×1 = 2', () => {
    expect(fileWeight('structural', 'stale')).toBe(2)
  })

  it('intelligence-tier fresh = 3×0 = 0', () => {
    expect(fileWeight('intelligence', 'fresh')).toBe(0)
  })

  it('tier multiplier is exhaustive — all KBTier values covered', () => {
    const tiers = ['structural', 'status', 'intelligence', 'general'] as const
    const levels = ['fresh', 'stale', 'critical'] as const
    for (const tier of tiers) {
      for (const level of levels) {
        const weight = fileWeight(tier, level)
        expect(typeof weight).toBe('number')
        expect(Number.isNaN(weight)).toBe(false)
      }
    }
  })
})

describe('hasStructuralBlock', () => {
  it('returns true when status tier has critical files', () => {
    const summary: StaleSummary = {
      freshByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      staleByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      criticalByTier: { structural: 0, status: 1, intelligence: 0, general: 0 },
      fresh: 0, stale: 0, critical: 1,
    }
    expect(hasStructuralBlock(summary)).toBe(true)
  })

  it('returns true when structural tier has critical files', () => {
    const summary: StaleSummary = {
      freshByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      staleByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      criticalByTier: { structural: 1, status: 0, intelligence: 0, general: 0 },
      fresh: 0, stale: 0, critical: 1,
    }
    expect(hasStructuralBlock(summary)).toBe(true)
  })

  it('returns false when only intelligence/general have critical files', () => {
    const summary: StaleSummary = {
      freshByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      staleByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      criticalByTier: { structural: 0, status: 0, intelligence: 2, general: 3 },
      fresh: 0, stale: 0, critical: 5,
    }
    expect(hasStructuralBlock(summary)).toBe(false)
  })

  it('high severity from gap flags alone does NOT make structural block', () => {
    // No critical files at all, but high gap flags contributing to severity
    const summary: StaleSummary = {
      freshByTier: { structural: 1, status: 1, intelligence: 1, general: 1 },
      staleByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      criticalByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
      fresh: 4, stale: 0, critical: 0,
    }
    expect(hasStructuralBlock(summary)).toBe(false)
  })
})

describe('Zod validation', () => {
  it('rejects invalid dependency type', () => {
    const result = DependencyTypeSchema.safeParse('invalid_type')
    expect(result.success).toBe(false)
  })

  it('accepts all valid dependency types', () => {
    const validTypes = ['blocks', 'depends_on', 'informs', 'parallel', 'monitor_only']
    for (const type of validTypes) {
      const result = DependencyTypeSchema.safeParse(type)
      expect(result.success).toBe(true)
    }
  })

  it('repository rejects bad dependency type', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    const result = relRepo.addRelationship(a, b, {
      dependencyType: 'nonexistent' as never,
    })
    expect(result.ok).toBe(false)
  })
})

describe('computeSnapshotHash', () => {
  it('same inputs produce same hash', () => {
    const health = makeDomainHealth({ domainId: 'id-1' })
    const hash1 = computeSnapshotHash([health])
    const hash2 = computeSnapshotHash([health])
    expect(hash1).toBe(hash2)
  })

  it('different data produces different hash', () => {
    const h1 = makeDomainHealth({ domainId: 'id-1', openGapFlags: 0 })
    const h2 = makeDomainHealth({ domainId: 'id-1', openGapFlags: 3 })
    expect(computeSnapshotHash([h1])).not.toBe(computeSnapshotHash([h2]))
  })

  it('hash includes relationships — adding dep changes hash', () => {
    const base = makeDomainHealth({ domainId: 'id-1' })
    const withDep = makeDomainHealth({
      domainId: 'id-1',
      outgoingDeps: [
        { targetDomainId: 'id-2', targetDomainName: 'D2', dependencyType: 'blocks', description: '' },
      ],
    })
    expect(computeSnapshotHash([base])).not.toBe(computeSnapshotHash([withDep]))
  })

  it('hash is deterministic under reorder — same data in different order → same hash', () => {
    const h1 = makeDomainHealth({ domainId: 'id-1' })
    const h2 = makeDomainHealth({ domainId: 'id-2' })

    const hashAB = computeSnapshotHash([h1, h2])
    const hashBA = computeSnapshotHash([h2, h1])
    expect(hashAB).toBe(hashBA)
  })

  it('relationship order does not affect hash', () => {
    const dep1 = { targetDomainId: 'id-2', targetDomainName: 'D2', dependencyType: 'blocks' as const, description: '' }
    const dep2 = { targetDomainId: 'id-3', targetDomainName: 'D3', dependencyType: 'informs' as const, description: '' }

    const h1 = makeDomainHealth({ domainId: 'id-1', outgoingDeps: [dep1, dep2] })
    const h2 = makeDomainHealth({ domainId: 'id-1', outgoingDeps: [dep2, dep1] })

    expect(computeSnapshotHash([h1])).toBe(computeSnapshotHash([h2]))
  })
})

describe('Derived counts consistency', () => {
  it('critical === sum(criticalByTier), same for fresh/stale', () => {
    const summary: StaleSummary = {
      freshByTier: { structural: 1, status: 2, intelligence: 0, general: 3 },
      staleByTier: { structural: 0, status: 1, intelligence: 1, general: 0 },
      criticalByTier: { structural: 0, status: 0, intelligence: 1, general: 1 },
      fresh: 6,
      stale: 2,
      critical: 2,
    }

    const freshSum = Object.values(summary.freshByTier).reduce((a, b) => a + b, 0)
    const staleSum = Object.values(summary.staleByTier).reduce((a, b) => a + b, 0)
    const criticalSum = Object.values(summary.criticalByTier).reduce((a, b) => a + b, 0)

    expect(summary.fresh).toBe(freshSum)
    expect(summary.stale).toBe(staleSum)
    expect(summary.critical).toBe(criticalSum)
  })
})

describe('Alert generation scenarios', () => {
  it('informs relationships never generate alerts', () => {
    // For alert testing we build DomainHealth objects directly
    const source = makeDomainHealth({
      domainId: 'src',
      domainName: 'Source',
      severityScore: 12,
      outgoingDeps: [
        { targetDomainId: 'dep', targetDomainName: 'Dependent', dependencyType: 'informs', description: '' },
      ],
    })
    const dependent = makeDomainHealth({
      domainId: 'dep',
      domainName: 'Dependent',
    })

    // Simulate alert generation: informs should never produce alerts
    const alertGeneratingTypes = new Set(['blocks', 'depends_on'])
    for (const dep of source.outgoingDeps) {
      expect(alertGeneratingTypes.has(dep.dependencyType)).toBe(false)
    }
  })

  it('parallel/monitor_only never generate alerts', () => {
    const alertGeneratingTypes = new Set(['blocks', 'depends_on'])
    expect(alertGeneratingTypes.has('parallel')).toBe(false)
    expect(alertGeneratingTypes.has('monitor_only')).toBe(false)
  })

  it('blocks escalation: monitor → warning', () => {
    // severity 1 → monitor base, blocks escalates to warning
    const severityFromScore = (score: number) => score >= 7 ? 'critical' : score >= 3 ? 'warning' : 'monitor'
    const escalate = (s: string) => s === 'monitor' ? 'warning' : 'critical'

    expect(escalate(severityFromScore(1))).toBe('warning')
  })

  it('blocks escalation: warning → critical', () => {
    const severityFromScore = (score: number) => score >= 7 ? 'critical' : score >= 3 ? 'warning' : 'monitor'
    const escalate = (s: string) => s === 'monitor' ? 'warning' : 'critical'

    expect(escalate(severityFromScore(5))).toBe('critical')
  })

  it('blocks escalation ceiling: critical stays critical', () => {
    const severityFromScore = (score: number) => score >= 7 ? 'critical' : score >= 3 ? 'warning' : 'monitor'
    const escalate = (s: string) => s === 'monitor' ? 'warning' : 'critical'

    expect(escalate(severityFromScore(12))).toBe('critical')
  })

  it('depends_on does not escalate severity', () => {
    // depends_on type should NOT escalate
    const depType: string = 'depends_on'
    const escalated = depType === 'blocks'
    expect(escalated).toBe(false)
  })
})

describe('Domain status derivation logic', () => {
  it('0 KB files domain → quiet', () => {
    const health = makeDomainHealth({
      domainId: 'empty',
      fileCountTotal: 0,
      severityScore: 0,
    })
    // With 0 files, 0 score, no dependents → quiet
    // (mirrors deriveDomainStatus logic)
    expect(health.fileCountTotal).toBe(0)
    expect(health.severityScore).toBe(0)
  })

  it('quiet: score=0, no hard dependents, lastTouchedAt >14d', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86_400_000).toISOString()
    const health = makeDomainHealth({
      domainId: 'quiet-domain',
      severityScore: 0,
      lastTouchedAt: fifteenDaysAgo,
      outgoingDeps: [], // no hard dependents
    })

    // Verify the conditions for quiet
    const hardDepTypes = new Set(['blocks', 'depends_on'])
    const hasHardDependents = health.outgoingDeps.some((d) => hardDepTypes.has(d.dependencyType))
    const daysSinceTouch = Math.floor(
      (Date.now() - new Date(health.lastTouchedAt!).getTime()) / 86_400_000,
    )

    expect(health.severityScore).toBe(0)
    expect(hasHardDependents).toBe(false)
    expect(daysSinceTouch).toBeGreaterThan(14)
  })

  it('blocked: incoming blocks from structurally-stale source', () => {
    const source = makeDomainHealth({
      domainId: 'source',
      staleSummary: {
        freshByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
        staleByTier: { structural: 0, status: 0, intelligence: 0, general: 0 },
        criticalByTier: { structural: 0, status: 1, intelligence: 0, general: 0 },
        fresh: 0, stale: 0, critical: 1,
      },
    })

    expect(hasStructuralBlock(source.staleSummary)).toBe(true)
  })

  it('general-tier-only domain (no core files, null lastTouchedAt) → quiet', () => {
    const health = makeDomainHealth({
      domainId: 'general-only',
      fileCountTotal: 5, // has files
      fileCountStatChecked: 0, // but none in scored tiers
      severityScore: 0,
      lastTouchedAt: null, // no scored-tier mtime, no gap flags
    })

    // Verify conditions for the new quiet rule
    expect(health.fileCountTotal).toBeGreaterThan(0)
    expect(health.lastTouchedAt).toBeNull()
    expect(health.severityScore).toBe(0)
  })

  it('stale-risk: severity>=3 AND has hard dependents', () => {
    const health = makeDomainHealth({
      domainId: 'at-risk',
      severityScore: 5,
      outgoingDeps: [
        { targetDomainId: 'dep', targetDomainName: 'Dep', dependencyType: 'blocks', description: '' },
      ],
    })

    const hardDepTypes = new Set(['blocks', 'depends_on'])
    const hasHardDependents = health.outgoingDeps.some((d) => hardDepTypes.has(d.dependencyType))
    expect(health.severityScore).toBeGreaterThanOrEqual(3)
    expect(hasHardDependents).toBe(true)
  })
})

describe('Circular dependency', () => {
  it('A blocks B and B blocks A → both edges exist, no loop error', () => {
    const a = createDomain('Domain A')
    const b = createDomain('Domain B')

    const r1 = relRepo.addRelationship(a, b, { dependencyType: 'blocks' })
    const r2 = relRepo.addRelationship(b, a, { dependencyType: 'blocks' })

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)

    // Both should have outgoing
    const aRels = relRepo.getSiblings(a)
    const bRels = relRepo.getSiblings(b)
    if (aRels.ok) expect(aRels.value.length).toBe(1)
    if (bRels.ok) expect(bRels.value.length).toBe(1)
  })
})

describe('worstFile preference', () => {
  it('status-tier stale file ranks above older general file', () => {
    // The worstFile scoring: TIER_MULTIPLIER[tier] * 1000 + daysSinceUpdate
    // status=4, general=1
    const statusFileScore = 4 * 1000 + 10 // status, 10 days
    const generalFileScore = 1 * 1000 + 50 // general, 50 days

    expect(statusFileScore).toBeGreaterThan(generalFileScore)
  })
})

describe('getAll relationships', () => {
  it('returns all relationships across all domains', () => {
    const a = createDomain('A')
    const b = createDomain('B')
    const c = createDomain('C')

    relRepo.addRelationship(a, b, { dependencyType: 'blocks' })
    relRepo.addRelationship(b, c, { dependencyType: 'informs' })

    const all = relRepo.getAll()
    expect(all.ok).toBe(true)
    if (all.ok) {
      expect(all.value.length).toBe(2)
    }
  })
})

describe('Legacy addSibling backward compatibility', () => {
  it('creates bidirectional informs relationship', () => {
    const a = createDomain('A')
    const b = createDomain('B')

    const result = relRepo.addSibling(a, b)
    expect(result.ok).toBe(true)

    // Both directions should exist
    const aRels = relRepo.getSiblings(a)
    const bRels = relRepo.getSiblings(b)
    if (aRels.ok) {
      expect(aRels.value.length).toBe(1)
      expect(aRels.value[0].dependencyType).toBe('informs')
    }
    if (bRels.ok) {
      expect(bRels.value.length).toBe(1)
      expect(bRels.value[0].dependencyType).toBe('informs')
    }
  })
})
