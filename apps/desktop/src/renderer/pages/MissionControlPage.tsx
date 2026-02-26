import { useEffect, useState, useCallback } from 'react'
import { useMissionStore, useDomainStore } from '../stores'
import { MissionGateModal } from '../components/MissionGateModal'
import type {
  MissionSummary,
  MissionRunOutput,
  MissionRunDetailData,
  MissionRunSummaryData,
} from '../../preload/api'
import type { ActiveView } from '../App'

// ── Constants ──

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

const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  success: { bg: 'bg-green-500/20', text: 'text-green-400' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400' },
  cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  gated: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  running: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  pending: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
}

// ── Sub-components ──

function OutputAlertCard({ output }: { output: MissionRunOutput }): React.JSX.Element {
  const data = output.contentJson
  const severity = (data.severity as string) || 'monitor'
  const borderClass = ALERT_SEVERITY_COLORS[severity] ?? ALERT_SEVERITY_COLORS.monitor
  const badgeClass = ALERT_BADGE_COLORS[severity] ?? ALERT_BADGE_COLORS.monitor

  return (
    <div className={`rounded-lg border p-3 ${borderClass}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badgeClass}`}>
          {severity}
        </span>
        <span className="text-xs font-medium text-text-primary">{data.domain as string}</span>
      </div>
      <p className="text-xs text-text-secondary">{data.text as string}</p>
      {data.evidence != null && (
        <p className="mt-1 text-[10px] text-text-tertiary">{String(data.evidence)}</p>
      )}
    </div>
  )
}

function OutputActionCard({ output }: { output: MissionRunOutput }): React.JSX.Element {
  const data = output.contentJson
  const priority = (data.priority as number) || 4
  const priorityClass = PRIORITY_COLORS[priority] ?? 'bg-gray-500/20 text-gray-400'

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${priorityClass}`}>
          P{priority}
        </span>
        <span className="text-xs font-medium text-text-primary">{data.domain as string}</span>
        {data.deadline != null && data.deadline !== 'none' && (
          <span className="ml-auto text-[10px] text-text-tertiary">{String(data.deadline)}</span>
        )}
      </div>
      <p className="text-xs text-text-secondary">{data.text as string}</p>
    </div>
  )
}

function OutputMonitorCard({ output }: { output: MissionRunOutput }): React.JSX.Element {
  const data = output.contentJson

  return (
    <div className="rounded-lg border border-gray-500/20 bg-gray-500/5 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-text-primary">{data.domain as string}</span>
      </div>
      <p className="text-xs text-text-secondary">{data.text as string}</p>
    </div>
  )
}

function RunHistoryTable({ history }: { history: MissionRunSummaryData[] }): React.JSX.Element {
  if (history.length === 0) {
    return <p className="py-4 text-center text-xs text-text-tertiary">No runs yet</p>
  }

  return (
    <div className="space-y-1">
      {history.map((run) => {
        const badge = STATUS_BADGES[run.status] ?? STATUS_BADGES.pending
        const date = run.startedAt ? new Date(run.startedAt) : new Date(run.createdAt)
        const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(0)}s` : '—'

        return (
          <div
            key={run.id}
            className="flex items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-surface-2"
          >
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.bg} ${badge.text}`}>
              {run.status}
            </span>
            <span className="text-text-secondary">
              {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
              {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="text-text-tertiary">{duration}</span>
            {run.error && (
              <span className="ml-auto truncate text-red-400" title={run.error}>
                {run.error.slice(0, 40)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ProvenancePanel({ detail }: { detail: MissionRunDetailData }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const run = detail.run
  const ctx = run.contextJson as Record<string, unknown>

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-text-secondary hover:text-text-primary"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Run Provenance
      </button>
      {expanded && (
        <div className="px-4 pb-3 text-xs text-text-tertiary space-y-1">
          <p>Model: <span className="text-text-secondary">{run.modelId}</span></p>
          <p>Provider: <span className="text-text-secondary">{run.provider}</span></p>
          <p>Definition hash: <span className="font-mono text-text-secondary">{run.missionDefinitionHash.slice(0, 12)}...</span></p>
          <p>Prompt hash: <span className="font-mono text-text-secondary">{run.promptHash.slice(0, 12)}...</span></p>
          {run.durationMs != null && (
            <p>Duration: <span className="text-text-secondary">{(run.durationMs / 1000).toFixed(1)}s</span></p>
          )}
          {ctx.domainsRead != null && (
            <p>Domains read: <span className="text-text-secondary">{String((ctx.domainsRead as string[]).length)}</span></p>
          )}
          {ctx.promptChars != null && (
            <p>Prompt chars: <span className="text-text-secondary">{Number(ctx.promptChars).toLocaleString()}</span></p>
          )}
          {run.startedAt && (
            <p className="italic">Read digests as of {new Date(run.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ──

export function MissionControlPage({ onViewChange }: { onViewChange: (view: ActiveView) => void }): React.JSX.Element {
  const domains = useDomainStore((s) => s.domains)
  const activeDomainId = useDomainStore((s) => s.activeDomainId)
  const allMissions = useMissionStore((s) => s.allMissions)
  const missions = useMissionStore((s) => s.missions)
  const missionsLoading = useMissionStore((s) => s.missionsLoading)
  const fetchAllMissions = useMissionStore((s) => s.fetchAllMissions)
  const fetchMissions = useMissionStore((s) => s.fetchMissions)
  const enableForDomain = useMissionStore((s) => s.enableForDomain)
  const disableForDomain = useMissionStore((s) => s.disableForDomain)
  const running = useMissionStore((s) => s.running)
  const runningDomainId = useMissionStore((s) => s.runningDomainId)
  const startRun = useMissionStore((s) => s.startRun)
  const cancelRun = useMissionStore((s) => s.cancelRun)
  const decideGate = useMissionStore((s) => s.decideGate)
  const runHistory = useMissionStore((s) => s.runHistory)
  const fetchHistory = useMissionStore((s) => s.fetchHistory)
  const switchDomain = useMissionStore((s) => s.switchDomain)
  const clearRun = useMissionStore((s) => s.clearRun)

  // State for the selected domain and mission inputs
  const [selectedDomainId, setSelectedDomainId] = useState(activeDomainId || (domains[0]?.id ?? ''))
  const [createDeadlines, setCreateDeadlines] = useState(false)
  const [draftEmailTo, setDraftEmailTo] = useState('')
  const [selectedMission, setSelectedMission] = useState<MissionSummary | null>(null)

  // Per-domain selectors (depend on selectedDomainId)
  const activeRun = useMissionStore((s) => s.activeRunByDomain[selectedDomainId] ?? null)
  const streamingText = useMissionStore((s) => s.streamingTextByDomain[selectedDomainId] ?? '')
  const runError = useMissionStore((s) => s.runErrorByDomain[selectedDomainId] ?? null)
  const pendingGate = useMissionStore((s) => s.pendingGateByDomain[selectedDomainId] ?? null)

  // Load all missions + domain-specific missions
  useEffect(() => {
    fetchAllMissions()
  }, [fetchAllMissions])

  useEffect(() => {
    if (selectedDomainId) {
      fetchMissions(selectedDomainId)
      fetchHistory(selectedDomainId)
      switchDomain(selectedDomainId)
    }
  }, [selectedDomainId, fetchMissions, fetchHistory, switchDomain])

  // Auto-select first mission
  useEffect(() => {
    if (missions.length > 0 && !selectedMission) {
      setSelectedMission(missions[0])
    }
    // Clear selection if mission was disabled
    if (selectedMission && missions.length > 0 && !missions.find((m) => m.id === selectedMission.id)) {
      setSelectedMission(missions[0])
    }
    if (missions.length === 0) {
      setSelectedMission(null)
    }
  }, [missions, selectedMission])

  // Derive which missions are enabled for this domain
  const enabledMissionIds = new Set(missions.map((m) => m.id))

  const handleRun = useCallback(async () => {
    if (!selectedMission || !selectedDomainId || running) return
    await startRun(selectedMission.id, selectedDomainId, {
      createDeadlines,
      draftEmailTo: draftEmailTo.trim(),
    })
  }, [selectedMission, selectedDomainId, running, createDeadlines, draftEmailTo, startRun])

  // Parse outputs for display
  const alerts = activeRun?.outputs.filter((o) => o.outputType === 'alert') ?? []
  const actions = activeRun?.outputs.filter((o) => o.outputType === 'action') ?? []
  const monitors = activeRun?.outputs.filter((o) => o.outputType === 'monitor') ?? []

  // Gate modal data
  const gateOutputSummary = {
    alerts: alerts.length,
    actions: actions.length,
    monitors: monitors.length,
  }
  const gatePendingActions: string[] = []
  if (activeRun) {
    for (const action of activeRun.actions) {
      if (action.status === 'pending') {
        if (action.type === 'create_deadline') {
          gatePendingActions.push(`Create deadline: ${action.actionId}`)
        } else if (action.type === 'draft_email') {
          gatePendingActions.push(`Draft email to ${draftEmailTo}`)
        }
      }
    }
  }

  const selectedDomainName = domains.find((d) => d.id === selectedDomainId)?.name ?? ''

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold text-text-primary">Mission Control</h1>
        <select
          value={selectedDomainId}
          onChange={(e) => setSelectedDomainId(e.target.value)}
          className="rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-secondary"
        >
          {domains.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Mission loading state */}
        {missionsLoading && (
          <p className="text-xs text-text-tertiary">Loading missions...</p>
        )}

        {/* Mission library — show all available missions with enable/disable */}
        {!missionsLoading && allMissions.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <h3 className="mb-3 text-xs font-medium text-text-secondary">Available Missions</h3>
            <div className="space-y-2">
              {allMissions.map((m) => {
                const isEnabled = enabledMissionIds.has(m.id)
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded border border-border bg-surface-0 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-text-primary">{m.name}</p>
                      <p className="truncate text-[10px] text-text-tertiary">{m.description}</p>
                    </div>
                    <button
                      onClick={() =>
                        isEnabled
                          ? disableForDomain(m.id, selectedDomainId)
                          : enableForDomain(m.id, selectedDomainId)
                      }
                      className={`ml-3 shrink-0 rounded px-2.5 py-1 text-[10px] font-medium transition-colors ${
                        isEnabled
                          ? 'bg-green-500/15 text-green-500 hover:bg-red-500/15 hover:text-red-400'
                          : 'bg-surface-2 text-text-tertiary hover:bg-accent/15 hover:text-accent-text'
                      }`}
                    >
                      {isEnabled ? 'Enabled' : 'Enable'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* No missions available at all */}
        {!missionsLoading && allMissions.length === 0 && (
          <div className="rounded border border-border bg-surface-1 p-4 text-center">
            <p className="text-xs text-text-secondary">No missions available.</p>
          </div>
        )}

        {/* Mission card */}
        {selectedMission && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm">&#127919;</span>
              <h2 className="text-sm font-semibold text-text-primary">{selectedMission.name}</h2>
            </div>
            <p className="text-xs text-text-secondary">{selectedMission.description}</p>
          </div>
        )}

        {/* Parameters form */}
        {selectedMission && (
          <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
            <h3 className="text-xs font-medium text-text-secondary">Parameters</h3>
            <label className="flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={createDeadlines}
                onChange={(e) => setCreateDeadlines(e.target.checked)}
                className="rounded border-border"
              />
              Auto-create deadlines
            </label>
            <div>
              <label className="mb-1 block text-xs text-text-secondary">Email recipient (optional)</label>
              <input
                type="email"
                value={draftEmailTo}
                onChange={(e) => setDraftEmailTo(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded border border-border bg-surface-0 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary"
              />
            </div>
          </div>
        )}

        {/* Capabilities disclosure */}
        {selectedMission && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Capabilities</h3>
            <div className="flex flex-wrap gap-2 text-[10px] text-text-tertiary">
              <span className="rounded bg-surface-2 px-1.5 py-0.5">Read KB</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5">Stream LLM</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5">Cross-domain: {domains.map((d) => d.name).join(', ')}</span>
              {createDeadlines && <span className="rounded bg-surface-2 px-1.5 py-0.5">Create deadlines</span>}
              {draftEmailTo && <span className="rounded bg-surface-2 px-1.5 py-0.5">Draft email</span>}
            </div>
          </div>
        )}

        {/* Run button */}
        {selectedMission && (
          <div className="flex justify-center gap-3">
            <button
              onClick={handleRun}
              disabled={running}
              className="rounded bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {running ? 'Running...' : 'Run Mission'}
            </button>
            {running && (
              <button
                onClick={cancelRun}
                className="rounded border border-border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-surface-2"
              >
                Cancel
              </button>
            )}
            {!running && activeRun && (
              <button
                onClick={() => clearRun(selectedDomainId)}
                className="rounded border border-border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-surface-2"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {runError && (
          <div className="rounded border border-red-500/40 bg-red-500/5 p-3">
            <p className="text-xs text-red-400">{runError}</p>
          </div>
        )}

        {/* Streaming output */}
        {((running && runningDomainId === selectedDomainId) || streamingText) && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Output</h3>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary font-mono">
              {streamingText || 'Waiting for response...'}
            </pre>
          </div>
        )}

        {/* Parsed outputs */}
        {activeRun && (alerts.length > 0 || actions.length > 0 || monitors.length > 0) && (
          <div className="space-y-4">
            {alerts.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-text-secondary">
                  Alerts ({alerts.length})
                </h3>
                <div className="space-y-2">
                  {alerts.map((a) => <OutputAlertCard key={a.id} output={a} />)}
                </div>
              </div>
            )}

            {actions.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-text-secondary">
                  Recommended Actions ({actions.length})
                </h3>
                <div className="space-y-2">
                  {actions.map((a) => <OutputActionCard key={a.id} output={a} />)}
                </div>
              </div>
            )}

            {monitors.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-text-secondary">
                  Monitors ({monitors.length})
                </h3>
                <div className="space-y-2">
                  {monitors.map((m) => <OutputMonitorCard key={m.id} output={m} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Provenance */}
        {activeRun && activeRun.run.status !== 'pending' && activeRun.run.status !== 'running' && (
          <ProvenancePanel detail={activeRun} />
        )}

        {/* Run History */}
        <div className="border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-medium text-text-secondary">Run History</h3>
          <RunHistoryTable history={runHistory} />
        </div>
      </div>

      {/* Gate modal */}
      {pendingGate && (
        <MissionGateModal
          message={pendingGate.message}
          outputs={gateOutputSummary}
          pendingActions={gatePendingActions}
          onApprove={() => decideGate(true, selectedDomainId)}
          onReject={() => decideGate(false, selectedDomainId)}
        />
      )}
    </div>
  )
}
