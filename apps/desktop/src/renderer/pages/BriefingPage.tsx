import { useEffect, useState, useCallback } from 'react'
import { useBriefingStore, useDomainStore, useDeadlineStore } from '../stores'
import type { DomainHealth, DomainStatus, CrossDomainAlert, BriefingAnalysis, Deadline } from '../../preload/api'
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

/** Deterministic hash for sourceRef — stable even if text has minor edits */
function hashSourceRef(text: string, domainId: string): string {
  let h = 0x811c9dc5
  const s = text + '::' + domainId
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** Categorize due date relative to today */
function categorizeDueDate(dueDate: string): 'overdue' | 'today' | 'this-week' | 'upcoming' | 'future' {
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  const todayMs = new Date(today + 'T00:00:00Z').getTime()
  const dueMs = new Date(dueDate + 'T00:00:00Z').getTime()
  const days = Math.round((dueMs - todayMs) / 86_400_000)
  if (days <= 7) return 'this-week'
  if (days <= 30) return 'upcoming'
  return 'future'
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
        {health.overdueDeadlines > 0 && (
          <span className="text-red-400">{health.overdueDeadlines} overdue</span>
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

// ── Deadline components ──

function DeadlineCard({
  deadline,
  domainName,
  onComplete,
  onSnooze,
  onCancel,
}: {
  deadline: Deadline
  domainName: string
  onComplete: (id: string) => void
  onSnooze: (id: string) => void
  onCancel: (id: string) => void
}): React.JSX.Element {
  const [completing, setCompleting] = useState(false)
  const [acting, setActing] = useState(false)
  const category = categorizeDueDate(deadline.dueDate)

  const borderClass =
    category === 'overdue'
      ? 'border-red-500/40 bg-red-500/5'
      : category === 'today'
        ? 'border-amber-500/60 bg-amber-500/5 border-2'
        : category === 'this-week'
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border'

  const priorityClass = PRIORITY_COLORS[deadline.priority] ?? 'bg-gray-500/20 text-gray-400'

  if (completing) {
    return (
      <div className={`rounded-lg border p-3 opacity-50 ${borderClass}`}>
        <span className="text-xs text-green-400">Completed</span>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border p-3 ${borderClass}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${priorityClass}`}>
          P{deadline.priority}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary truncate">{domainName}</span>
            <span className={`text-[10px] ${category === 'overdue' ? 'text-red-400 font-semibold' : category === 'today' ? 'text-amber-400 font-semibold' : 'text-text-tertiary'}`}>
              {deadline.dueDate}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">{deadline.text}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            disabled={acting}
            onClick={async () => {
              setActing(true)
              onComplete(deadline.id)
              setCompleting(true)
              setTimeout(() => setCompleting(false), 3000)
              setActing(false)
            }}
            className="rounded px-1.5 py-0.5 text-[10px] text-green-400 hover:bg-green-500/10 disabled:opacity-50"
          >
            Done
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={async () => {
              setActing(true)
              onSnooze(deadline.id)
              setActing(false)
            }}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-3 disabled:opacity-50"
          >
            +7d
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={async () => {
              setActing(true)
              onCancel(deadline.id)
              setActing(false)
            }}
            className="rounded px-1.5 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-3 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function DeadlineCreateForm({
  domains,
  onCreated,
}: {
  domains: Array<{ id: string; name: string }>
  onCreated: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState(4)
  const [domainId, setDomainId] = useState(domains[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const { create } = useDeadlineStore()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-dashed border-border px-3 py-1.5 text-xs text-text-tertiary hover:border-accent/40 hover:text-text-secondary"
      >
        + Add deadline
      </button>
    )
  }

  async function handleSubmit(): Promise<void> {
    if (!text.trim() || !dueDate || !domainId) return
    setSaving(true)
    await create({ domainId, text: text.trim(), dueDate, priority })
    setSaving(false)
    setText('')
    setDueDate('')
    setPriority(4)
    setOpen(false)
    onCreated()
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex gap-2">
        <select
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
        >
          {domains.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary w-16"
        >
          {[1, 2, 3, 4, 5, 6, 7].map((p) => (
            <option key={p} value={p}>P{p}</option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
          style={{ colorScheme: 'dark' }}
        />
      </div>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Deadline description..."
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !text.trim() || !dueDate}
          className="rounded bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-1 text-xs text-text-tertiary hover:bg-surface-3"
        >
          Cancel
        </button>
      </div>
    </div>
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

function AnalysisActionItem({
  action,
  domains,
  onCaptured,
}: {
  action: BriefingAnalysis['actions'][0]
  domains: Array<{ id: string; name: string }>
  onCaptured: () => void
}): React.JSX.Element {
  const priorityClass = PRIORITY_COLORS[action.priority] ?? 'bg-gray-500/20 text-gray-400'
  const [capturing, setCapturing] = useState(false)
  const [captured, setCaptured] = useState(false)
  const { create, findBySourceRef } = useDeadlineStore()

  // Find domain ID from action domain name
  const matchedDomain = domains.find((d) => d.name.toLowerCase() === action.domain.toLowerCase())
  const canCapture = action.deadline !== 'none' && matchedDomain

  // Check if already captured on mount
  useEffect(() => {
    if (!canCapture || !matchedDomain) return
    const ref = hashSourceRef(action.text, matchedDomain.id)
    findBySourceRef(matchedDomain.id, ref).then((existing) => {
      if (existing) setCaptured(true)
    })
  }, [action.text, matchedDomain?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCapture(): Promise<void> {
    if (!matchedDomain) return
    setCapturing(true)
    const ref = hashSourceRef(action.text, matchedDomain.id)

    // Duplicate check
    const existing = await findBySourceRef(matchedDomain.id, ref)
    if (existing) {
      setCaptured(true)
      setCapturing(false)
      return
    }

    // Parse deadline text to date if possible, default to 7 days from now
    let dueDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const dateMatch = action.deadline.match(/\d{4}-\d{2}-\d{2}/)
    if (dateMatch) dueDate = dateMatch[0]

    await create({
      domainId: matchedDomain.id,
      text: action.text,
      dueDate,
      priority: action.priority,
      source: 'briefing',
      sourceRef: ref,
    })

    setCaptured(true)
    setCapturing(false)
    onCaptured()
  }

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
      {canCapture && (
        <button
          type="button"
          disabled={capturing || captured}
          onClick={handleCapture}
          title={captured ? 'Already captured' : 'Capture as deadline'}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            captured
              ? 'text-green-400 cursor-default'
              : 'text-accent hover:bg-accent/10 disabled:opacity-50'
          }`}
        >
          {captured ? 'Captured' : capturing ? '...' : 'Capture'}
        </button>
      )}
    </div>
  )
}

function AnalysisSection({
  analysis,
  domains,
  onDeadlineCaptured,
}: {
  analysis: BriefingAnalysis
  domains: Array<{ id: string; name: string }>
  onDeadlineCaptured: () => void
}): React.JSX.Element {
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
              <AnalysisActionItem
                key={`action-${i}`}
                action={action}
                domains={domains}
                onCaptured={onDeadlineCaptured}
              />
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

// ── Overdue Google Tasks with actions ──

function OverdueGTasksSection({
  tasks,
  onMutated,
}: {
  tasks: Array<{ id: string; taskListId: string; taskListTitle: string; title: string; due: string; notes: string }>
  onMutated: () => void
}): React.JSX.Element {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  // Clear stale hidden IDs when tasks list refreshes — a task that reappears
  // in the fresh list was not actually mutated server-side
  useEffect(() => {
    setHiddenIds(new Set())
  }, [tasks])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ title: string; notes: string; due: string }>({ title: '', notes: '', due: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const taskKey = (t: { taskListId: string; id: string }): string => `${t.taskListId}::${t.id}`

  function handleStartEdit(task: { id: string; taskListId: string; title: string; due: string; notes: string }): void {
    const dueDate = task.due ? new Date(task.due).toISOString().slice(0, 10) : ''
    setEditingId(taskKey(task))
    setEditValues({ title: task.title || '', notes: task.notes || '', due: dueDate })
    setSaveError(null)
  }

  function handleCancelEdit(): void {
    setEditingId(null)
    setSaveError(null)
  }

  async function handleSaveEdit(task: { id: string; taskListId: string; title: string; due: string; notes: string }): Promise<void> {
    if (!editValues.title.trim()) return
    const originalDue = task.due ? new Date(task.due).toISOString().slice(0, 10) : ''
    const updates: { title?: string; notes?: string; due?: string } = {}
    if (editValues.title !== (task.title || '')) updates.title = editValues.title
    if (editValues.notes !== (task.notes || '')) updates.notes = editValues.notes
    if (editValues.due !== originalDue) updates.due = editValues.due
    if (Object.keys(updates).length === 0) {
      setEditingId(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await window.domainOS.gtasks.updateTask(task.taskListId, task.id, updates)
      if (!res.ok) {
        console.error('[GTasks] Update failed:', res.error)
        setSaveError(res.error || 'Save failed')
      } else {
        setEditingId(null)
        onMutated()
      }
    } catch (err) {
      console.error('[GTasks] Update threw:', err)
      setSaveError('Save failed — check connection')
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete(task: { taskListId: string; id: string }): Promise<void> {
    const key = taskKey(task)
    if (loadingIds.has(key)) return
    setLoadingIds((prev) => new Set(prev).add(key))
    setHiddenIds((prev) => new Set(prev).add(key))

    try {
      const res = await window.domainOS.gtasks.completeTask(task.taskListId, task.id)
      if (!res.ok) {
        setHiddenIds((prev) => { const next = new Set(prev); next.delete(key); return next })
        console.error('[GTasks] Complete failed:', res.error)
      } else {
        onMutated()
      }
    } catch (err) {
      setHiddenIds((prev) => { const next = new Set(prev); next.delete(key); return next })
      console.error('[GTasks] Complete threw:', err)
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  async function handleDelete(task: { taskListId: string; id: string }): Promise<void> {
    const key = taskKey(task)
    if (loadingIds.has(key)) return
    setLoadingIds((prev) => new Set(prev).add(key))
    setHiddenIds((prev) => new Set(prev).add(key))

    try {
      const res = await window.domainOS.gtasks.deleteTask(task.taskListId, task.id)
      if (!res.ok) {
        setHiddenIds((prev) => { const next = new Set(prev); next.delete(key); return next })
        console.error('[GTasks] Delete failed:', res.error)
      } else {
        onMutated()
      }
    } catch (err) {
      setHiddenIds((prev) => { const next = new Set(prev); next.delete(key); return next })
      console.error('[GTasks] Delete threw:', err)
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const visibleTasks = tasks.filter((t) => !hiddenIds.has(taskKey(t)))

  const byList = new Map<string, typeof visibleTasks>()
  for (const task of visibleTasks) {
    const key = task.taskListTitle || 'Untitled List'
    if (!byList.has(key)) byList.set(key, [])
    byList.get(key)!.push(task)
  }

  if (visibleTasks.length === 0) return <></>

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-text-secondary">
        Overdue Google Tasks
        <span className="ml-2 text-xs text-amber-400">{visibleTasks.length}</span>
      </h2>
      <div className="space-y-3">
        {[...byList.entries()].map(([listTitle, listTasks]) => (
          <div key={listTitle}>
            <p className="mb-1 text-xs font-semibold text-amber-400/80 uppercase tracking-wide">{listTitle}</p>
            <div className="space-y-1.5">
              {listTasks.map((task) => {
                const dueDate = task.due ? new Date(task.due) : null
                const dueStr = dueDate ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
                const key = taskKey(task)
                const isLoading = loadingIds.has(key)
                const isEditing = editingId === key

                if (isEditing) {
                  return (
                    <div
                      key={key}
                      className="rounded border border-accent/40 bg-surface-2 px-3 py-2 space-y-1.5"
                      onKeyDown={(e) => { if (e.key === 'Escape') handleCancelEdit() }}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValues.title}
                          onChange={(e) => setEditValues((v) => ({ ...v, title: e.target.value }))}
                          className="flex-1 rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                          placeholder="Title"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleComplete(task)}
                          title="Mark as complete"
                          className="rounded px-1.5 py-0.5 text-[10px] text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                        >
                          Done
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editValues.notes}
                          onChange={(e) => setEditValues((v) => ({ ...v, notes: e.target.value }))}
                          className="flex-1 rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
                          placeholder="Notes"
                        />
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleDelete(task)}
                          title="Delete task"
                          className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Del
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={editValues.due}
                          onChange={(e) => setEditValues((v) => ({ ...v, due: e.target.value }))}
                          className="rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-primary"
                          style={{ colorScheme: 'dark' }}
                        />
                        <div className="flex-1" />
                        <button
                          type="button"
                          disabled={saving || !editValues.title.trim()}
                          onClick={() => handleSaveEdit(task)}
                          className="rounded bg-accent/20 px-2 py-0.5 text-[10px] text-accent hover:bg-accent/30 disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={handleCancelEdit}
                          className="rounded px-2 py-0.5 text-[10px] text-text-tertiary hover:bg-surface-3"
                        >
                          Cancel
                        </button>
                      </div>
                      {saveError && (
                        <p className="text-[10px] text-red-400">{saveError}</p>
                      )}
                    </div>
                  )
                }

                return (
                  <div
                    key={key}
                    className="flex items-start gap-3 rounded border border-border/50 bg-surface-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-xs font-medium text-text-primary cursor-pointer hover:text-accent transition-colors"
                        onClick={() => handleStartEdit(task)}
                        title="Click to edit"
                      >
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
                        <span
                          className="text-text-primary cursor-pointer hover:text-accent transition-colors"
                          onClick={() => handleStartEdit(task)}
                          title="Click to reschedule"
                        >
                          {dueStr}
                        </span>
                      </div>
                      {task.notes && (
                        <p
                          className="mt-0.5 line-clamp-1 text-[10px] text-text-tertiary cursor-pointer hover:text-text-secondary transition-colors"
                          onClick={() => handleStartEdit(task)}
                          title="Click to edit"
                        >
                          {task.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleComplete(task)}
                        title="Mark as complete"
                        className="rounded px-1.5 py-0.5 text-[10px] text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleDelete(task)}
                        title="Delete task"
                        className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
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
  const { setActiveDomain, domains } = useDomainStore()
  const { overdueAll, fetchOverdue, complete, snooze, cancel } = useDeadlineStore()

  // GTasks connection state
  const [gtasksConnected, setGtasksConnected] = useState(false)
  const [gtasksEmail, setGtasksEmail] = useState<string | undefined>()
  const [gtasksLoading, setGtasksLoading] = useState(false)

  const checkGTasksStatus = useCallback(async () => {
    const res = await window.domainOS.gtasks.checkConnected()
    if (res.ok && res.value) {
      setGtasksConnected(res.value.connected)
      setGtasksEmail(res.value.email)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    fetchOverdue()
    checkGTasksStatus()

    // Subscribe to unsnooze wake events
    window.domainOS.deadline.onUnsnoozeWake(() => {
      fetchOverdue()
      fetchHealth()
    })
    return () => {
      window.domainOS.deadline.offUnsnoozeWake()
    }
  }, [fetchHealth, fetchOverdue, checkGTasksStatus])

  async function handleGTasksConnect(): Promise<void> {
    setGtasksLoading(true)
    const res = await window.domainOS.gtasks.startOAuth()
    setGtasksLoading(false)
    if (res.ok) {
      await checkGTasksStatus()
      fetchHealth() // re-fetch to get updated overdue count
    } else {
      console.error('[GTasks] OAuth failed:', res.error)
      alert(`Google Tasks connect failed: ${res.error}`)
    }
  }

  async function handleGTasksDisconnect(): Promise<void> {
    setGtasksLoading(true)
    await window.domainOS.gtasks.disconnect()
    setGtasksLoading(false)
    setGtasksConnected(false)
    setGtasksEmail(undefined)
    fetchHealth()
  }

  const handleDeadlineCaptured = useCallback(() => {
    fetchOverdue()
    fetchHealth()
  }, [fetchOverdue, fetchHealth])

  function handleDomainSelect(domainId: string): void {
    setActiveDomain(domainId)
    onViewChange('domains')
  }

  function handleComplete(id: string): void {
    complete(id)
  }

  function handleSnooze(id: string): void {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    snooze(id, until)
  }

  function handleCancel(id: string): void {
    cancel(id)
  }

  const hashMismatch =
    health &&
    analysisSnapshotHash !== null &&
    analysisSnapshotHash !== health.snapshotHash

  // Build domain name map for deadline cards
  const domainNameMap = new Map<string, string>()
  if (health) {
    for (const dh of health.domains) {
      domainNameMap.set(dh.domainId, dh.domainName)
    }
  }

  // Compute deadline summary stats
  const today = new Date().toISOString().slice(0, 10)
  const todayEnd = new Date(new Date(today + 'T00:00:00Z').getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const overdueCount = overdueAll.length
  const dueThisWeekCount = overdueAll.length === 0 ? 0 : 0 // overdueAll only has overdue items

  // We need upcoming data — compute from the overdue list what we can show
  // For the banner, fetch upcoming count from all active deadlines visible
  // For simplicity, use what we have: overdue count from the store

  // Sort deadlines: priority DESC then due_date ASC
  const sortedDeadlines = [...overdueAll].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.dueDate.localeCompare(b.dueDate)
  })

  // Domain list for create form and capture
  const domainList = health
    ? health.domains.map((d) => ({ id: d.domainId, name: d.domainName }))
    : domains.map((d) => ({ id: d.id, name: d.name }))

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Portfolio Health</h1>
          <div className="flex items-center gap-3">
            {health && (
              <p className="text-xs text-text-tertiary">
                Last computed: {formatTime(health.computedAt)}
              </p>
            )}
            {health && (health.globalOverdueGTasks ?? 0) > 0 && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                {health.globalOverdueGTasks} overdue GTasks
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* GTasks connection */}
          {gtasksConnected ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-tertiary">
                Tasks: {gtasksEmail || 'connected'}
              </span>
              <button
                type="button"
                onClick={handleGTasksDisconnect}
                disabled={gtasksLoading}
                className="rounded border border-border px-2 py-1 text-[10px] text-text-tertiary transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGTasksConnect}
              disabled={gtasksLoading}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
            >
              {gtasksLoading ? 'Connecting...' : 'Connect Tasks'}
            </button>
          )}
          <button
            type="button"
            onClick={() => { fetchHealth(); fetchOverdue() }}
            disabled={healthLoading}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {healthLoading ? 'Computing...' : 'Refresh'}
          </button>
        </div>
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

          {/* Analysis Alerts */}
          {!analyzing && analysis != null && (analysis.alerts ?? []).length > 0 && (
            <div className="mb-6">
              <h2 className="mb-1 text-sm font-medium text-text-secondary">Analysis Alerts</h2>
              <p className="mb-2 text-xs text-text-tertiary">From the latest analysis run</p>
              <div className="space-y-2">
                {(analysis.alerts ?? []).map((alert, i) => (
                  <AnalysisAlertCard
                    key={`analysis-alert:${alert.severity}:${alert.domain ?? 'all'}:${alert.text?.slice(0, 40) ?? ''}:${i}`}
                    alert={alert}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Deadlines Section */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-text-secondary">Deadlines</h2>
                {overdueCount > 0 && (
                  <span className="text-xs text-red-400">{overdueCount} overdue</span>
                )}
              </div>
            </div>

            {sortedDeadlines.length > 0 && (
              <div className="mb-3 space-y-2">
                {sortedDeadlines.map((dl) => (
                  <DeadlineCard
                    key={dl.id}
                    deadline={dl}
                    domainName={domainNameMap.get(dl.domainId) ?? 'Unknown'}
                    onComplete={handleComplete}
                    onSnooze={handleSnooze}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            )}

            {sortedDeadlines.length === 0 && (
              <p className="mb-3 text-xs text-text-tertiary">No overdue deadlines</p>
            )}

            <DeadlineCreateForm domains={domainList} onCreated={handleDeadlineCaptured} />
          </div>

          {/* Overdue Google Tasks Section — grouped by list */}
          {health.overdueGTasksList && health.overdueGTasksList.length > 0 && (
            <OverdueGTasksSection
              tasks={health.overdueGTasksList}
              onMutated={() => { fetchHealth(); fetchOverdue() }}
            />
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
                <AnalysisSection
                  analysis={analysis}
                  domains={domainList}
                  onDeadlineCaptured={handleDeadlineCaptured}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
