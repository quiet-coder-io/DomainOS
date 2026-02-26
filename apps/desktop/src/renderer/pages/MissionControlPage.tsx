import { useEffect, useState, useCallback, useMemo } from 'react'
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

const HEATMAP_SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-yellow-400',
  low: 'text-text-tertiary',
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

// ── Markdown renderer (shared) ──

const isRowLike = (l: string) => {
  const t = l.trim()
  return t.startsWith('|') && t.endsWith('|')
}

const parseTableRow = (line: string) =>
  line.trim().slice(1, -1).split('|').map((c) => c.trim())

const isSeparatorRow = (line: string, expectedCols: number) => {
  const cells = parseTableRow(line)
  if (cells.length !== expectedCols) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-surface-0 px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function renderMemoMarkdown(text: string): React.JSX.Element {
  const parts = text.split(/(```[\s\S]*?```)/g)
  const elements: React.JSX.Element[] = []
  let key = 0

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3).replace(/^\w*\n/, '')
      elements.push(
        <pre key={key++} className="my-2 rounded bg-surface-0 border border-border-subtle p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </pre>
      )
    } else {
      const paragraphs = part.split(/\n{2,}/)
      for (const para of paragraphs) {
        if (!para.trim()) continue
        const lines = para.split('\n')

        // Heading detection (## N. Title)
        if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) {
          const headingMatch = lines[0].match(/^(#{1,3})\s+(.*)$/)
          if (headingMatch) {
            const level = headingMatch[1].length
            const headingText = headingMatch[2]
            if (level === 2) {
              elements.push(<h3 key={key++} className="mt-3 mb-1 text-sm font-semibold text-text-primary">{renderInline(headingText)}</h3>)
            } else if (level === 3) {
              elements.push(<h4 key={key++} className="mt-2 mb-1 text-xs font-semibold text-text-primary">{renderInline(headingText)}</h4>)
            } else {
              elements.push(<h2 key={key++} className="mt-4 mb-2 text-base font-bold text-text-primary">{renderInline(headingText)}</h2>)
            }
            continue
          }
        }

        // Table detection
        const nonEmpty = lines.filter((l) => l.trim().length > 0)
        const isTable =
          nonEmpty.length >= 2 &&
          isRowLike(nonEmpty[0]) &&
          isRowLike(nonEmpty[1]) &&
          (() => {
            const headers = parseTableRow(nonEmpty[0])
            const headerCols = headers.length
            return headerCols >= 2 && headers.some((h) => h.length > 0) &&
              isSeparatorRow(nonEmpty[1], headerCols) &&
              nonEmpty.slice(2).every(isRowLike)
          })()

        if (isTable) {
          const headers = parseTableRow(nonEmpty[0])
          const bodyRows = nonEmpty.slice(2).map(parseTableRow)
          const colCount = headers.length
          const normalize = (row: string[]) => {
            if (row.length === colCount) return row
            if (row.length < colCount) return row.concat(Array(colCount - row.length).fill(''))
            return row.slice(0, colCount)
          }
          elements.push(
            <div key={key++} className="my-2 max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold">{renderInline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri}>
                      {normalize(row).map((cell, ci) => (
                        <td key={ci} className="border border-border-subtle px-2 py-1">{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        } else {
          const isList = lines.every((l) => /^[\s]*[-*]\s/.test(l) || !l.trim())
          if (isList) {
            const items = lines.filter((l) => /^[\s]*[-*]\s/.test(l))
            elements.push(
              <ul key={key++} className="my-1 list-disc pl-4 space-y-0.5">
                {items.map((item, i) => (
                  <li key={i}>{renderInline(item.replace(/^[\s]*[-*]\s/, ''))}</li>
                ))}
              </ul>
            )
          } else {
            elements.push(<p key={key++} className="my-1 text-xs text-text-secondary leading-relaxed">{renderInline(para)}</p>)
          }
        }
      }
    }
  }

  return <>{elements}</>
}

// ── Loan Review Output Card ──

function LoanReviewMemoCard({ output }: { output: MissionRunOutput }): React.JSX.Element {
  const [showHeatmap, setShowHeatmap] = useState(true)
  const data = output.contentJson
  const fullText = (data.fullText as string) || ''
  const heatmap = data.heatmap as {
    riskItems?: Array<{ area: string; severity: string; description: string; cmbsRef?: string }>
    stopReview?: boolean
    stopReason?: string
    missingDocs?: string[]
    escalations?: Array<{ issue: string; urgency: string }>
  } | undefined

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text-primary">Loan Document Review Memo</h3>
        {heatmap && (
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className="text-[10px] text-text-tertiary hover:text-text-secondary"
          >
            {showHeatmap ? 'Hide risk heatmap' : 'Show risk heatmap'}
          </button>
        )}
      </div>

      {/* Stop review warning */}
      {heatmap?.stopReview && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-2">
          <p className="text-xs font-medium text-red-400">Review stopped: {heatmap.stopReason || 'Critical issues detected'}</p>
        </div>
      )}

      {/* Missing docs */}
      {heatmap?.missingDocs && heatmap.missingDocs.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="mb-1 text-[10px] font-medium text-amber-400">Missing Documents ({heatmap.missingDocs.length})</p>
          <ul className="list-disc pl-4 text-[10px] text-amber-300/80 space-y-0.5">
            {heatmap.missingDocs.map((doc, i) => <li key={i}>{doc}</li>)}
          </ul>
        </div>
      )}

      {/* Risk heatmap table */}
      {showHeatmap && heatmap?.riskItems && heatmap.riskItems.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold text-text-secondary">Area</th>
                <th className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold text-text-secondary">Severity</th>
                <th className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold text-text-secondary">Description</th>
                <th className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold text-text-secondary">CMBS Ref</th>
              </tr>
            </thead>
            <tbody>
              {heatmap.riskItems.map((item, i) => (
                <tr key={i}>
                  <td className="border border-border-subtle px-2 py-1 text-text-primary">{item.area}</td>
                  <td className={`border border-border-subtle px-2 py-1 font-medium ${HEATMAP_SEVERITY_COLORS[item.severity] ?? 'text-text-tertiary'}`}>
                    {item.severity}
                  </td>
                  <td className="border border-border-subtle px-2 py-1 text-text-secondary">{item.description}</td>
                  <td className="border border-border-subtle px-2 py-1 font-mono text-text-tertiary">{item.cmbsRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Escalations */}
      {heatmap?.escalations && heatmap.escalations.length > 0 && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2">
          <p className="mb-1 text-[10px] font-medium text-red-400">Escalations ({heatmap.escalations.length})</p>
          {heatmap.escalations.map((esc, i) => (
            <div key={i} className="flex items-start gap-2 text-[10px]">
              <span className="shrink-0 font-medium text-red-400">{esc.urgency}</span>
              <span className="text-text-secondary">{esc.issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Full memo text */}
      <div className="max-h-96 overflow-y-auto">
        {renderMemoMarkdown(fullText)}
      </div>
    </div>
  )
}

// ── Warnings Banner ──

function WarningsBanner({ warnings }: { warnings: Array<{ code: string; message: string }> }): React.JSX.Element {
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 text-amber-400">&#9888;</span>
          <span className="text-amber-300/90">{w.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── Dynamic Parameter Form ──

function DynamicParameterForm({
  mission,
  inputs,
  onChange,
}: {
  mission: MissionSummary
  inputs: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}): React.JSX.Element {
  const paramOrder = mission.parametersOrder ?? Object.keys(mission.parameters)

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-3">
      <h3 className="text-xs font-medium text-text-secondary">Parameters</h3>
      {paramOrder.map((key) => {
        const param = mission.parameters[key]
        if (!param) return null

        const value = inputs[key] ?? param.default

        // Boolean → checkbox
        if (param.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(key, e.target.checked)}
                className="rounded border-border"
              />
              {param.description}
            </label>
          )
        }

        // String with email hint → email input
        const isEmail = key.toLowerCase().includes('email')

        return (
          <div key={key}>
            <label className="mb-1 block text-xs text-text-secondary">{param.description}</label>
            <input
              type={isEmail ? 'email' : 'text'}
              value={String(value ?? '')}
              onChange={(e) => onChange(key, e.target.value)}
              placeholder={String(param.default ?? '')}
              className="w-full rounded border border-border bg-surface-0 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary"
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Provenance Panel ──

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
          {ctx.missionType != null && (
            <p>Mission type: <span className="text-text-secondary">{String(ctx.missionType)}</span></p>
          )}
          <p>Model: <span className="text-text-secondary">{run.modelId}</span></p>
          <p>Provider: <span className="text-text-secondary">{run.provider}</span></p>
          <p>Definition hash: <span className="font-mono text-text-secondary">{run.missionDefinitionHash.slice(0, 12)}...</span></p>
          <p>Prompt hash: <span className="font-mono text-text-secondary">{run.promptHash.slice(0, 12)}...</span></p>
          {ctx.contextHash != null && (
            <p>Context hash: <span className="font-mono text-text-secondary">{String(ctx.contextHash).slice(0, 12)}...</span></p>
          )}
          {run.durationMs != null && (
            <p>Duration: <span className="text-text-secondary">{(run.durationMs / 1000).toFixed(1)}s</span></p>
          )}
          {ctx.domainsRead != null && (
            <p>Domains read: <span className="text-text-secondary">{String((ctx.domainsRead as string[]).length)}</span></p>
          )}
          {ctx.systemPromptChars != null && (
            <p>System prompt: <span className="text-text-secondary">{Number(ctx.systemPromptChars).toLocaleString()} chars</span></p>
          )}
          {ctx.userPromptChars != null && (
            <p>User prompt: <span className="text-text-secondary">{Number(ctx.userPromptChars).toLocaleString()} chars</span></p>
          )}
          {/* Legacy field for older runs */}
          {ctx.promptChars != null && ctx.systemPromptChars == null && (
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
  const [selectedMission, setSelectedMission] = useState<MissionSummary | null>(null)
  const [missionInputs, setMissionInputs] = useState<Record<string, unknown>>({})

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

  // Initialize inputs from parameter defaults when mission changes
  useEffect(() => {
    if (!selectedMission) {
      setMissionInputs({})
      return
    }
    const defaults: Record<string, unknown> = {}
    for (const [key, param] of Object.entries(selectedMission.parameters)) {
      defaults[key] = param.default
    }
    setMissionInputs(defaults)
  }, [selectedMission?.id])

  // Derive which missions are enabled for this domain
  const enabledMissionIds = new Set(missions.map((m) => m.id))

  const handleInputChange = useCallback((key: string, value: unknown) => {
    setMissionInputs((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleRun = useCallback(async () => {
    if (!selectedMission || !selectedDomainId || running) return
    // Trim string values before sending
    const trimmedInputs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(missionInputs)) {
      trimmedInputs[key] = typeof value === 'string' ? value.trim() : value
    }
    await startRun(selectedMission.id, selectedDomainId, trimmedInputs)
  }, [selectedMission, selectedDomainId, running, missionInputs, startRun])

  // Parse outputs for display
  const alerts = activeRun?.outputs.filter((o) => o.outputType === 'alert') ?? []
  const actions = activeRun?.outputs.filter((o) => o.outputType === 'action') ?? []
  const monitors = activeRun?.outputs.filter((o) => o.outputType === 'monitor') ?? []
  const loanReviewMemos = activeRun?.outputs.filter((o) => o.outputType === 'loan_review_memo') ?? []

  // Run-level warnings from contextJson
  const runWarnings = useMemo(() => {
    if (!activeRun?.run.contextJson) return []
    const w = (activeRun.run.contextJson as Record<string, unknown>).warnings
    if (!Array.isArray(w)) return []
    return w as Array<{ code: string; message: string }>
  }, [activeRun?.run.contextJson])

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
          // Pull email from stored run inputs, not UI state
          const storedEmail = (activeRun.run.inputsJson as Record<string, unknown>).draftEmailTo as string ?? ''
          gatePendingActions.push(`Draft email to ${storedEmail}`)
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

        {/* Mission selector + card */}
        {missions.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">Mission:</label>
            <select
              value={selectedMission?.id ?? ''}
              onChange={(e) => {
                const m = missions.find((m) => m.id === e.target.value)
                if (m) setSelectedMission(m)
              }}
              className="rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-secondary"
            >
              {missions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedMission && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm">&#127919;</span>
              <h2 className="text-sm font-semibold text-text-primary">{selectedMission.name}</h2>
            </div>
            <p className="text-xs text-text-secondary">{selectedMission.description}</p>
          </div>
        )}

        {/* Dynamic parameters form */}
        {selectedMission && Object.keys(selectedMission.parameters).length > 0 && (
          <DynamicParameterForm
            mission={selectedMission}
            inputs={missionInputs}
            onChange={handleInputChange}
          />
        )}

        {/* Capabilities disclosure */}
        {selectedMission && (
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Capabilities</h3>
            <div className="flex flex-wrap gap-2 text-[10px] text-text-tertiary">
              {/* Methodology — from definition */}
              {selectedMission.methodology && (
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent-text">
                  {selectedMission.methodology}
                </span>
              )}
              <span className="rounded bg-surface-2 px-1.5 py-0.5">Read KB</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5">Stream LLM</span>
              {selectedMission.scope === 'single-domain' ? (
                <span className="rounded bg-surface-2 px-1.5 py-0.5">Domain: {selectedDomainName}</span>
              ) : (
                <span className="rounded bg-surface-2 px-1.5 py-0.5">Cross-domain: {domains.map((d) => d.name).join(', ')}</span>
              )}
              {/* Output types — from definition */}
              {selectedMission.outputLabels?.map((label) => (
                <span key={label} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-400">{label}</span>
              ))}
              {/* Dynamic capabilities from inputs */}
              {Boolean(missionInputs.createDeadlines) && <span className="rounded bg-surface-2 px-1.5 py-0.5">Create deadlines</span>}
              {Boolean(missionInputs.draftEmailTo) && <span className="rounded bg-surface-2 px-1.5 py-0.5">Draft email</span>}
            </div>
          </div>
        )}

        {/* Run / Stop button */}
        {selectedMission && (
          <div className="flex justify-center gap-3">
            {running ? (
              <button
                onClick={cancelRun}
                className="rounded bg-red-500 px-4 py-2 text-xs font-medium text-white hover:bg-red-600"
              >
                Stop Mission
              </button>
            ) : (
              <button
                onClick={handleRun}
                className="rounded bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90"
              >
                Run Mission
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
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-text-secondary">Output</h3>
              {running && runningDomainId === selectedDomainId && (
                <button
                  onClick={cancelRun}
                  className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/25"
                >
                  Stop
                </button>
              )}
            </div>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary font-mono">
              {streamingText || 'Waiting for response...'}
            </pre>
          </div>
        )}

        {/* Run warnings */}
        {runWarnings.length > 0 && <WarningsBanner warnings={runWarnings} />}

        {/* Loan review memo outputs */}
        {loanReviewMemos.length > 0 && (
          <div className="space-y-4">
            {loanReviewMemos.map((m) => <LoanReviewMemoCard key={m.id} output={m} />)}
          </div>
        )}

        {/* Portfolio briefing outputs (alerts, actions, monitors) */}
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
