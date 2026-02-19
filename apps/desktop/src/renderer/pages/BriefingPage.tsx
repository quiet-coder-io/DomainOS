import { useEffect, useState } from 'react'
import { useBriefingStore, useDomainStore } from '../stores'
import type { DomainHealth, DomainStatus, CrossDomainAlert, BriefingAnalysis } from '../../preload/api'
import type { ActiveView } from '../App'

const STATUS_COLORS: Record<DomainStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  quiet: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  'stale-risk': { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  blocked: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
}

const ALERT_SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  monitor: 'border-gray-500/30 bg-gray-500/5',
}

const ALERT_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  warning: 'bg-amber-500/20 text-amber-400',
  monitor: 'bg-gray-500/20 text-gray-400',
}

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-500/20 text-red-400',
  2: 'bg-amber-500/20 text-amber-400',
  3: 'bg-amber-500/20 text-amber-400',
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function AlertCard({ alert }: { alert: CrossDomainAlert }): React.JSX.Element {
  const borderClass = ALERT_SEVERITY_COLORS[alert.severity] ?? ALERT_SEVERITY_COLORS.monitor
  const badgeClass = ALERT_BADGE_COLORS[alert.severity] ?? ALERT_BADGE_COLORS.monitor

  return (
    <div className={`rounded-lg border p-3 ${borderClass}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badgeClass}`}>
          {alert.severity}
        </span>
        <span className="text-sm font-medium text-text-primary">
          {alert.sourceDomainName} → {alert.dependentDomainName}
        </span>
      </div>
      <p className="text-xs text-text-secondary">{alert.text}</p>
      {alert.trace.escalated && (
        <p className="mt-1 text-[10px] text-text-tertiary">
          Score: {alert.trace.baseSeverityScore} — escalated via {alert.trace.dependencyType}
        </p>
      )}
    </div>
  )
}

function DomainCard({
  health,
  onSelect,
}: {
  health: DomainHealth
  onSelect: (id: string) => void
}): React.JSX.Element {
  const colors = STATUS_COLORS[health.status]

  return (
    <button
      type="button"
      onClick={() => onSelect(health.domainId)}
      className={`flex flex-col items-start rounded-lg border border-border p-3 text-left transition-colors hover:border-accent/40 ${colors.bg}`}
    >
      <div className="mb-2 flex w-full items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
        <span className="flex-1 truncate text-sm font-medium text-text-primary">
          {health.domainName}
        </span>
        <span className={`text-[10px] font-medium ${colors.text}`}>{health.status}</span>
      </div>

      <div className="flex w-full flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-tertiary">
        <span>{health.fileCountTotal} file{health.fileCountTotal !== 1 ? 's' : ''}</span>
        {health.openGapFlags > 0 && (
          <span className="text-amber-400">{health.openGapFlags} gap{health.openGapFlags !== 1 ? 's' : ''}</span>
        )}
        <span>score: {health.severityScore}</span>
      </div>

      {(health.outgoingDeps.length > 0 || health.incomingDeps.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {health.outgoingDeps
            .filter((d) => d.dependencyType === 'blocks' || d.dependencyType === 'depends_on')
            .map((d) => (
              <span key={`out-${d.targetDomainId}`} className="text-[10px] text-text-tertiary">
                → {d.targetDomainName}
              </span>
            ))}
          {health.incomingDeps
            .filter((d) => d.dependencyType === 'blocks' || d.dependencyType === 'depends_on')
            .map((d) => (
              <span key={`in-${d.sourceDomainId}`} className="text-[10px] text-text-tertiary">
                ← {d.sourceDomainName}
              </span>
            ))}
        </div>
      )}
    </button>
  )
}

// ── Analysis sub-components ──

function AnalysisAlertCard({ alert }: { alert: BriefingAnalysis['alerts'][0] }): React.JSX.Element {
  const borderClass = ALERT_SEVERITY_COLORS[alert.severity] ?? ALERT_SEVERITY_COLORS.monitor
  const badgeClass = ALERT_BADGE_COLORS[alert.severity] ?? ALERT_BADGE_COLORS.monitor

  return (
    <div className={`rounded-lg border p-3 ${borderClass}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badgeClass}`}>
          {alert.severity}
        </span>
        <span className="text-xs font-medium text-text-primary">{alert.domain}</span>
      </div>
      <p className="text-xs text-text-secondary">{alert.text}</p>
      <p className="mt-1 text-[10px] text-text-tertiary">{alert.evidence}</p>
    </div>
  )
}

function AnalysisActionItem({ action }: { action: BriefingAnalysis['actions'][0] }): React.JSX.Element {
  const priorityClass = PRIORITY_COLORS[action.priority] ?? 'bg-gray-500/20 text-gray-400'

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-3">
      <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${priorityClass}`}>
        P{action.priority}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{action.domain}</span>
          {action.deadline !== 'none' && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-tertiary">
              {action.deadline}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">{action.text}</p>
      </div>
    </div>
  )
}

function AnalysisSection({ analysis }: { analysis: BriefingAnalysis }): React.JSX.Element {
  const [showRaw, setShowRaw] = useState(false)

  const sortedActions = [...analysis.actions].sort((a, b) => a.priority - b.priority)

  return (
    <div className="space-y-4">
      {/* Actions */}
      {sortedActions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Actions</h3>
          <div className="space-y-2">
            {sortedActions.map((action, i) => (
              <AnalysisActionItem key={`action-${i}`} action={action} />
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {analysis.alerts.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Alerts</h3>
          <div className="space-y-2">
            {analysis.alerts.map((alert, i) => (
              <AnalysisAlertCard key={`alert-${i}`} alert={alert} />
            ))}
          </div>
        </div>
      )}

      {/* Monitors */}
      {analysis.monitors.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Monitor</h3>
          <div className="space-y-1">
            {analysis.monitors.map((m, i) => (
              <div key={`monitor-${i}`} className="flex items-start gap-2 text-xs text-text-tertiary">
                <span className="mt-0.5 text-[10px]">~</span>
                <span>
                  <span className="font-medium text-text-secondary">{m.domain}:</span> {m.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diagnostics */}
      {analysis.diagnostics.skippedBlocks > 0 && (
        <details className="text-xs text-text-tertiary">
          <summary className="cursor-pointer text-amber-400">
            {analysis.diagnostics.skippedBlocks} block{analysis.diagnostics.skippedBlocks !== 1 ? 's' : ''} skipped
          </summary>
          <ul className="mt-1 list-inside list-disc space-y-0.5 pl-2">
            {analysis.diagnostics.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Raw output toggle */}
      <details open={showRaw} onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[10px] text-text-tertiary">
          Show raw output
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-2 p-2 text-[10px] text-text-tertiary whitespace-pre-wrap">
          {analysis.rawText}
        </pre>
      </details>
    </div>
  )
}

// ── Main page ──

interface BriefingPageProps {
  onViewChange: (view: ActiveView) => void
}

export function BriefingPage({ onViewChange }: BriefingPageProps): React.JSX.Element {
  const {
    health, healthLoading, fetchHealth,
    analysis, analysisSnapshotHash, analyzing,
    streamingText, analyzeError,
    analyze, cancelAnalysis,
  } = useBriefingStore()
  const { setActiveDomain } = useDomainStore()

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  function handleDomainSelect(domainId: string): void {
    setActiveDomain(domainId)
    onViewChange('domains')
  }

  const hashMismatch =
    health &&
    analysisSnapshotHash !== null &&
    analysisSnapshotHash !== health.snapshotHash

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Portfolio Health</h1>
          {health && (
            <p className="text-xs text-text-tertiary">
              Last computed: {formatTime(health.computedAt)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          disabled={healthLoading}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          {healthLoading ? 'Computing...' : 'Refresh'}
        </button>
      </div>

      {healthLoading && !health && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-text-tertiary">Computing portfolio health...</p>
        </div>
      )}

      {health && (
        <>
          {/* Cross-Domain Alerts */}
          {health.alerts.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-medium text-text-secondary">Cross-Domain Alerts</h2>
              <div className="space-y-2">
                {health.alerts.map((alert, i) => (
                  <AlertCard key={`${alert.sourceDomainId}-${alert.dependentDomainId}-${i}`} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {/* Domain Cards Grid */}
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-medium text-text-secondary">Domains</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {health.domains.map((dh) => (
                <DomainCard key={dh.domainId} health={dh} onSelect={handleDomainSelect} />
              ))}
            </div>
          </div>

          {/* Analysis Section */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-text-secondary">Analysis</h2>
                {analysis && !analyzing && (
                  <p className="text-xs text-text-tertiary">
                    Based on snapshot from {formatTime(health.computedAt)}
                  </p>
                )}
                {hashMismatch && (
                  <p className="text-xs text-amber-400">
                    Health changed since last analysis — re-analyze?
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {analyzing && (
                  <button
                    type="button"
                    onClick={cancelAnalysis}
                    className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={analyze}
                  disabled={analyzing}
                  className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
                >
                  {analyzing ? 'Analyzing...' : 'Analyze Portfolio'}
                </button>
              </div>
            </div>

            {/* Error state */}
            {analyzeError && (
              <p className="mt-2 text-xs text-red-400">{analyzeError}</p>
            )}

            {/* Streaming state */}
            {analyzing && streamingText && (
              <pre className="mt-3 max-h-48 overflow-auto rounded bg-surface-2 p-3 text-[11px] text-text-tertiary whitespace-pre-wrap font-mono">
                {streamingText}
              </pre>
            )}

            {/* Parsed results */}
            {!analyzing && analysis && (
              <div className="mt-3">
                <AnalysisSection analysis={analysis} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
