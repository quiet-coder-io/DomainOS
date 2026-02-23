import { useEffect, useState } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import { useAdvisoryStore } from '../stores/advisory-store'
import type { AdvisoryArtifact, AdvisoryType, AdvisoryStatus } from '../../preload/api'

const TYPE_COLORS: Record<AdvisoryType, string> = {
  brainstorm: 'bg-accent/15 text-accent',
  risk_assessment: 'bg-danger/15 text-danger',
  scenario: 'bg-warning/15 text-warning',
  strategic_review: 'bg-success/15 text-success',
}

const TYPE_LABELS: Record<AdvisoryType, string> = {
  brainstorm: 'Brainstorm',
  risk_assessment: 'Risk',
  scenario: 'Scenario',
  strategic_review: 'Review',
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

interface Props {
  domainId: string
}

export function AdvisoryPanel({ domainId }: Props): React.JSX.Element {
  const { artifacts, loading, filter, fetchArtifacts, setFilter, archive, unarchive } = useAdvisoryStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetchArtifacts(domainId)
  }, [domainId, filter, fetchArtifacts])

  const activeCount = artifacts.filter((a) => a.status === 'active').length
  const archivedCount = artifacts.filter((a) => a.status === 'archived').length

  const statusFilter = filter.status ?? 'active'

  function handleStatusFilter(status: AdvisoryStatus | undefined) {
    setFilter({ ...filter, status })
    setExpandedId(null)
  }

  function handleTypeFilter(type: AdvisoryType | undefined) {
    setFilter({ ...filter, type: filter.type === type ? undefined : type })
    setExpandedId(null)
  }

  return (
    <CollapsibleSection title="Strategic History" count={artifacts.length} defaultOpen={false}>
      {/* Status filter */}
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => handleStatusFilter('active')}
          className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
            statusFilter === 'active' ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => handleStatusFilter('archived')}
          className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
            statusFilter === 'archived' ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Archived ({archivedCount})
        </button>
        <button
          onClick={() => handleStatusFilter(undefined)}
          className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
            statusFilter === undefined ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          All
        </button>
      </div>

      {/* Type filter */}
      <div className="mb-3 flex flex-wrap gap-1">
        {(['brainstorm', 'risk_assessment', 'scenario', 'strategic_review'] as AdvisoryType[]).map((type) => (
          <button
            key={type}
            onClick={() => handleTypeFilter(type)}
            className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
              filter.type === type ? TYPE_COLORS[type] : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <p className="text-xs text-text-tertiary">Loading...</p>}

      {/* Empty state */}
      {!loading && artifacts.length === 0 && (
        <p className="text-xs text-text-tertiary">No advisory artifacts found.</p>
      )}

      {/* Artifact cards */}
      {artifacts.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          expanded={expandedId === artifact.id}
          onToggle={() => setExpandedId(expandedId === artifact.id ? null : artifact.id)}
          onArchive={() => archive(artifact.id)}
          onUnarchive={() => unarchive(artifact.id)}
        />
      ))}
    </CollapsibleSection>
  )
}

interface ArtifactCardProps {
  artifact: AdvisoryArtifact
  expanded: boolean
  onToggle: () => void
  onArchive: () => void
  onUnarchive: () => void
}

function ArtifactCard({ artifact, expanded, onToggle, onArchive, onUnarchive }: ArtifactCardProps): React.JSX.Element {
  const dimmed = artifact.status === 'archived'

  return (
    <div className={`mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in ${dimmed ? 'opacity-60' : ''}`}>
      <button onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${TYPE_COLORS[artifact.type]}`}>
          {TYPE_LABELS[artifact.type]}
        </span>
        <span className="flex-1 truncate text-xs text-text-primary">{artifact.title}</span>
        <span className="shrink-0 text-[0.6rem] text-text-tertiary">{relativeTime(artifact.createdAt)}</span>
      </button>

      {expanded && <ArtifactDetail artifact={artifact} onArchive={onArchive} onUnarchive={onUnarchive} />}
    </div>
  )
}

function ArtifactDetail({ artifact, onArchive, onUnarchive }: {
  artifact: AdvisoryArtifact
  onArchive: () => void
  onUnarchive: () => void
}): React.JSX.Element {
  let content: Record<string, unknown> = {}
  try {
    content = JSON.parse(artifact.content)
  } catch {
    // invalid JSON — show raw
  }

  return (
    <div className="mt-2 space-y-2 text-xs animate-fade-in">
      {/* Type-specific content rendering */}
      {artifact.type === 'brainstorm' && <BrainstormContent content={content} />}
      {artifact.type === 'risk_assessment' && <RiskContent content={content} />}
      {artifact.type === 'scenario' && <ScenarioContent content={content} />}
      {artifact.type === 'strategic_review' && <ReviewContent content={content} />}

      {/* Actions */}
      <div className="flex gap-1 pt-1">
        {artifact.status === 'active' ? (
          <button onClick={onArchive} className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3">
            Archive
          </button>
        ) : (
          <button onClick={onUnarchive} className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3">
            Unarchive
          </button>
        )}
      </div>
    </div>
  )
}

// --- Type-specific content renderers ---

function BrainstormContent({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const topic = typeof content.topic === 'string' ? content.topic : ''
  const options = Array.isArray(content.options) ? content.options : []
  const recommendation = typeof content.recommendation === 'string' ? content.recommendation : ''

  return (
    <>
      {topic && (
        <div>
          <span className="font-medium text-text-secondary">Topic:</span>
          <p className="mt-0.5 text-text-tertiary">{topic}</p>
        </div>
      )}
      {options.length > 0 && (
        <div>
          <span className="font-medium text-text-secondary">Options ({options.length}):</span>
          {options.map((opt: Record<string, unknown>, i: number) => (
            <div key={i} className="mt-1 rounded border border-border-subtle bg-surface-1 p-2">
              <p className="font-medium text-text-primary">{String(opt.title ?? `Option ${i + 1}`)}</p>
              {opt.description ? <p className="mt-0.5 text-text-tertiary">{String(opt.description)}</p> : null}
            </div>
          ))}
        </div>
      )}
      {recommendation && (
        <div>
          <span className="font-medium text-text-secondary">Recommendation:</span>
          <p className="mt-0.5 text-text-tertiary">{recommendation}</p>
        </div>
      )}
    </>
  )
}

function RiskContent({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const summary = typeof content.summary === 'string' ? content.summary : ''
  const risks = Array.isArray(content.risks) ? content.risks : []
  const trend = typeof content.trend === 'string' ? content.trend : ''

  return (
    <>
      {summary && (
        <div>
          <span className="font-medium text-text-secondary">Summary:</span>
          <p className="mt-0.5 text-text-tertiary">{summary}</p>
        </div>
      )}
      {risks.length > 0 && (
        <div>
          <span className="font-medium text-text-secondary">Risks ({risks.length}):</span>
          {risks.map((risk: Record<string, unknown>, i: number) => (
            <div key={i} className="mt-1 rounded border border-border-subtle bg-surface-1 p-2">
              <p className="font-medium text-text-primary">{String(risk.category ?? `Risk ${i + 1}`)}</p>
              {risk.description ? <p className="mt-0.5 text-text-tertiary">{String(risk.description)}</p> : null}
              {risk.severity ? (
                <span className="mt-1 inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[0.6rem] text-danger">
                  {String(risk.severity)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {trend && (
        <div>
          <span className="font-medium text-text-secondary">Trend:</span>
          <span className="ml-1 text-text-tertiary">{trend}</span>
        </div>
      )}
    </>
  )
}

function ScenarioContent({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const scenarios = Array.isArray(content.scenarios) ? content.scenarios : []
  const variables = Array.isArray(content.variables) ? content.variables : []

  return (
    <>
      {variables.length > 0 && (
        <div>
          <span className="font-medium text-text-secondary">Variables:</span>
          <p className="mt-0.5 text-text-tertiary">{variables.map(String).join(', ')}</p>
        </div>
      )}
      {scenarios.length > 0 && (
        <div>
          <span className="font-medium text-text-secondary">Scenarios ({scenarios.length}):</span>
          {scenarios.map((s: Record<string, unknown>, i: number) => (
            <div key={i} className="mt-1 rounded border border-border-subtle bg-surface-1 p-2">
              <p className="font-medium text-text-primary">{String(s.name ?? `Scenario ${i + 1}`)}</p>
              {s.description ? <p className="mt-0.5 text-text-tertiary">{String(s.description)}</p> : null}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ReviewContent({ content }: { content: Record<string, unknown> }): React.JSX.Element {
  const posture = typeof content.posture === 'string' ? content.posture : ''
  const highestLeverage = typeof content.highest_leverage_action === 'string' ? content.highest_leverage_action : ''
  const tensions = Array.isArray(content.tensions) ? content.tensions : []

  return (
    <>
      {posture && (
        <div>
          <span className="font-medium text-text-secondary">Posture:</span>
          <p className="mt-0.5 text-text-tertiary">{posture}</p>
        </div>
      )}
      {highestLeverage && (
        <div>
          <span className="font-medium text-text-secondary">Highest-leverage action:</span>
          <p className="mt-0.5 text-text-tertiary">{highestLeverage}</p>
        </div>
      )}
      {tensions.length > 0 && (
        <div>
          <span className="font-medium text-text-secondary">Tensions:</span>
          <ul className="mt-0.5 list-inside list-disc text-text-tertiary">
            {tensions.map((t, i) => <li key={i}>{String(t)}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}
