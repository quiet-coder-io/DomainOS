import { useState, useEffect, useCallback } from 'react'
import { useAutomationStore } from '../stores/automation-store'
import type {
  Automation,
  AutomationRun,
  AutomationTriggerType,
  AutomationTriggerEvent,
  AutomationActionType,
} from '../../preload/api'
import { inputClass, primaryButtonClass, secondaryButtonClass } from './ui'

interface Props {
  domainId: string
  onClose(): void
}

type View = 'list' | 'create' | 'edit'

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  schedule: 'Schedule',
  event: 'Event',
  manual: 'Manual',
}

const EVENT_LABELS: Record<AutomationTriggerEvent, string> = {
  intake_created: 'Intake item created',
  kb_changed: 'KB files changed',
  gap_flag_raised: 'Gap flag raised',
  deadline_approaching: 'Deadline approaching',
}

const ACTION_LABELS: Record<AutomationActionType, string> = {
  notification: 'In-app notification',
  create_gtask: 'Create Google Task',
  draft_gmail: 'Draft Gmail',
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-success',
  failed: 'text-danger',
  running: 'text-accent',
  pending: 'text-text-tertiary',
  skipped: 'text-warning',
}

// ── Starter templates ──

interface StarterTemplate {
  label: string
  name: string
  triggerType: AutomationTriggerType
  triggerCron?: string
  triggerEvent?: AutomationTriggerEvent
  promptTemplate: string
  actionType: AutomationActionType
}

const STARTERS: StarterTemplate[] = [
  {
    label: 'Daily Briefing',
    name: 'Daily Briefing',
    triggerType: 'schedule',
    triggerCron: '0 9 * * 1-5',
    promptTemplate: 'Summarize the current state of {{domain_name}}. Highlight any urgent items, approaching deadlines, and recent changes. Keep it concise.',
    actionType: 'notification',
  },
  {
    label: 'KB Changed',
    name: 'KB Change Alert',
    triggerType: 'event',
    triggerEvent: 'kb_changed',
    promptTemplate: 'The knowledge base for {{domain_name}} has been updated. Summarize what likely changed and any implications.',
    actionType: 'notification',
  },
  {
    label: 'New Intake → Task',
    name: 'Intake to Task',
    triggerType: 'event',
    triggerEvent: 'intake_created',
    promptTemplate: 'A new intake item was captured for {{domain_name}}: {{event_data}}. Create a concise task title and description for follow-up.',
    actionType: 'create_gtask',
  },
]

// ── Main component ──

export function AutomationConfigDialog({ domainId, onClose }: Props): React.JSX.Element {
  const {
    automations,
    runs,
    loading,
    fetchAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    toggleAutomation,
    runAutomation,
    fetchRuns,
    resetFailures,
  } = useAutomationStore()

  const [view, setView] = useState<View>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedRunsId, setExpandedRunsId] = useState<string | null>(null)
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  useEffect(() => {
    fetchAutomations(domainId)
  }, [domainId, fetchAutomations])

  const handleEdit = useCallback((a: Automation) => {
    setEditingId(a.id)
    setView('edit')
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await deleteAutomation(id)
  }, [deleteAutomation])

  const handleToggleRuns = useCallback(async (automationId: string) => {
    if (expandedRunsId === automationId) {
      setExpandedRunsId(null)
      return
    }
    setExpandedRunsId(automationId)
    await fetchRuns(automationId, 20)
  }, [expandedRunsId, fetchRuns])

  const handleRunNow = useCallback(async (a: Automation) => {
    // Confirm for actions that create external resources
    if (a.actionType === 'create_gtask' || a.actionType === 'draft_gmail') {
      setConfirmRunId(a.id)
      return
    }
    setRunningId(a.id)
    await runAutomation(a.id)
    // Keep spinner for a bit while the async engine executes
    setTimeout(() => setRunningId(null), 3000)
  }, [runAutomation])

  const handleConfirmRun = useCallback(async () => {
    if (confirmRunId) {
      await runAutomation(confirmRunId)
      setConfirmRunId(null)
    }
  }, [confirmRunId, runAutomation])

  const handleStarterCreate = useCallback((starter: StarterTemplate) => {
    setEditingId(null)
    setView('create')
    // Will pass starter as initial values to form
    return starter // consumed by AutomationForm via initialValues
  }, [])

  // ── Render ──

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface-0 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-base font-semibold text-text-primary">
            {view === 'list' ? 'Automations' : view === 'create' ? 'New Automation' : 'Edit Automation'}
          </h2>
          <div className="flex items-center gap-2">
            {view === 'list' && (
              <button
                onClick={() => { setEditingId(null); setView('create') }}
                className={primaryButtonClass}
              >
                + New
              </button>
            )}
            <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === 'list' && (
            <AutomationList
              automations={automations}
              runs={runs}
              expandedRunsId={expandedRunsId}
              runningId={runningId}
              loading={loading}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={toggleAutomation}
              onRunNow={handleRunNow}
              onToggleRuns={handleToggleRuns}
              onResetFailures={resetFailures}
              starters={STARTERS}
              onStarterClick={handleStarterCreate}
            />
          )}
          {(view === 'create' || view === 'edit') && (
            <AutomationForm
              domainId={domainId}
              editingId={editingId}
              automations={automations}
              onSave={async (input: AutomationFormData) => {
                if (view === 'edit' && editingId) {
                  await updateAutomation(editingId, input)
                } else {
                  await createAutomation({
                    domainId,
                    name: input.name,
                    description: input.description,
                    triggerType: input.triggerType,
                    triggerCron: input.triggerCron,
                    triggerEvent: input.triggerEvent,
                    promptTemplate: input.promptTemplate,
                    actionType: input.actionType,
                    actionConfig: input.actionConfig,
                    catchUpEnabled: input.catchUpEnabled,
                    storePayloads: input.storePayloads,
                    deadlineWindowDays: input.deadlineWindowDays,
                  })
                }
                setView('list')
                setEditingId(null)
              }}
              onCancel={() => { setView('list'); setEditingId(null) }}
            />
          )}
        </div>
      </div>

      {/* Confirm run dialog */}
      {confirmRunId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-surface-1 p-5 shadow-xl max-w-sm">
            <p className="text-sm text-text-secondary mb-4">
              This automation will create an external resource (Google Task or Gmail draft). Run now?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRunId(null)} className={secondaryButtonClass}>Cancel</button>
              <button onClick={handleConfirmRun} className={primaryButtonClass}>Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── List view ──

interface ListProps {
  automations: Automation[]
  runs: AutomationRun[]
  expandedRunsId: string | null
  runningId: string | null
  loading: boolean
  onEdit(a: Automation): void
  onDelete(id: string): void
  onToggle(id: string): void
  onRunNow(a: Automation): void
  onToggleRuns(id: string): void
  onResetFailures(id: string): void
  starters: StarterTemplate[]
  onStarterClick(s: StarterTemplate): void
}

function AutomationList({
  automations, runs, expandedRunsId, runningId, loading,
  onEdit, onDelete, onToggle, onRunNow, onToggleRuns, onResetFailures,
  starters, onStarterClick,
}: ListProps): React.JSX.Element {
  if (loading) {
    return <p className="text-sm text-text-tertiary">Loading...</p>
  }

  if (automations.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-tertiary">No automations configured yet.</p>
        <div>
          <p className="mb-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">Quick Start</p>
          <div className="flex flex-wrap gap-2">
            {starters.map((s) => (
              <button
                key={s.label}
                onClick={() => onStarterClick(s)}
                className="rounded border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {automations.map((a) => (
        <div key={a.id} className="rounded-lg border border-border-subtle bg-surface-1 p-3">
          {/* Card header */}
          <div className="flex items-center gap-2">
            {/* Toggle */}
            <button
              onClick={() => onToggle(a.id)}
              className={`h-4 w-8 rounded-full transition-colors ${a.enabled ? 'bg-accent' : 'bg-surface-2'}`}
              title={a.enabled ? 'Disable' : 'Enable'}
            >
              <div className={`h-3 w-3 rounded-full bg-white transition-transform ${a.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>

            {/* Name + badges */}
            <span className="text-sm font-medium text-text-primary">{a.name}</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
              {TRIGGER_LABELS[a.triggerType]}
            </span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">
              {ACTION_LABELS[a.actionType]}
            </span>

            {/* Failure indicator */}
            {a.failureStreak >= 5 && (
              <span className="text-[10px] text-danger font-medium">Disabled (failures)</span>
            )}
            {a.failureStreak > 0 && a.failureStreak < 5 && (
              <span className="text-[10px] text-warning">{a.failureStreak} failures</span>
            )}

            <div className="flex-1" />

            {/* Actions */}
            <button
              onClick={() => onRunNow(a)}
              disabled={runningId === a.id}
              className="text-xs text-accent hover:bg-accent hover:text-white px-2 py-0.5 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              title="Run now"
            >
              {runningId === a.id ? (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent" />
                  Running…
                </span>
              ) : 'Run'}
            </button>
            <button onClick={() => onEdit(a)} className="text-xs text-text-tertiary hover:bg-surface-2 hover:text-text-primary px-2 py-0.5 rounded transition-colors">
              Edit
            </button>
            <button onClick={() => onDelete(a.id)} className="text-xs text-text-tertiary hover:bg-danger hover:text-white px-2 py-0.5 rounded transition-colors">
              Delete
            </button>
          </div>

          {/* Meta row */}
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary">
            {a.triggerType === 'schedule' && a.nextRunAt && (
              <span>Next: {formatRelativeTime(a.nextRunAt)}</span>
            )}
            {a.triggerType === 'event' && a.triggerEvent && (
              <span>On: {EVENT_LABELS[a.triggerEvent]}</span>
            )}
            {a.lastRunAt && (
              <span>Last: {formatRelativeTime(a.lastRunAt)}</span>
            )}
            <span>{a.runCount} runs</span>
            <button
              onClick={() => onToggleRuns(a.id)}
              className="hover:text-text-secondary underline decoration-dotted"
            >
              {expandedRunsId === a.id ? 'Hide history' : 'History'}
            </button>
          </div>

          {/* Disabled due to failures */}
          {a.failureStreak >= 5 && (
            <div className="mt-2 flex items-center gap-2 rounded bg-danger/10 px-2 py-1.5">
              <span className="text-xs text-danger">Disabled after {a.failureStreak} consecutive failures.</span>
              {a.lastError && <span className="text-xs text-text-tertiary truncate max-w-xs" title={a.lastError}>{a.lastError}</span>}
              <button onClick={() => onResetFailures(a.id)} className="ml-auto text-xs text-accent hover:text-accent-hover">
                Re-enable
              </button>
            </div>
          )}

          {/* Run history (collapsible) */}
          {expandedRunsId === a.id && (
            <div className="mt-2 border-t border-border-subtle pt-2">
              {runs.length === 0 ? (
                <p className="text-xs text-text-tertiary">No runs yet.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {runs.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-[11px]">
                      <span className={`font-mono ${STATUS_COLORS[r.status] ?? 'text-text-tertiary'}`}>
                        {r.status}
                      </span>
                      <span className="text-text-tertiary">{formatRelativeTime(r.createdAt)}</span>
                      {r.durationMs != null && (
                        <span className="text-text-tertiary">{r.durationMs}ms</span>
                      )}
                      {r.errorCode && (
                        <span className="text-danger">{r.errorCode}</span>
                      )}
                      {r.error && (
                        <span className="truncate max-w-xs text-text-tertiary" title={r.error}>{r.error}</span>
                      )}
                      {!r.promptRendered && r.promptHash && (
                        <span className="text-text-tertiary italic">payload not stored</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Form view ──

interface AutomationFormData {
  name: string
  description: string
  triggerType: AutomationTriggerType
  triggerCron: string | null
  triggerEvent: AutomationTriggerEvent | null
  promptTemplate: string
  actionType: AutomationActionType
  actionConfig: string
  catchUpEnabled: boolean
  storePayloads: boolean
  deadlineWindowDays: number | null
}

interface FormProps {
  domainId: string
  editingId: string | null
  automations: Automation[]
  onSave(input: AutomationFormData): Promise<void>
  onCancel(): void
}

function AutomationForm({ domainId, editingId, automations, onSave, onCancel }: FormProps): React.JSX.Element {
  const existing = editingId ? automations.find((a) => a.id === editingId) : null

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(existing?.triggerType ?? 'manual')
  const [triggerCron, setTriggerCron] = useState(existing?.triggerCron ?? '')
  const [triggerEvent, setTriggerEvent] = useState<AutomationTriggerEvent | null>(existing?.triggerEvent ?? null)
  const [promptTemplate, setPromptTemplate] = useState(existing?.promptTemplate ?? '')
  const [actionType, setActionType] = useState<AutomationActionType>(existing?.actionType ?? 'notification')
  const [actionConfig, setActionConfig] = useState(existing?.actionConfig ?? '{}')
  const [catchUpEnabled, setCatchUpEnabled] = useState(existing?.catchUpEnabled ?? false)
  const [storePayloads, setStorePayloads] = useState(existing?.storePayloads ?? false)
  const [deadlineWindowDays, setDeadlineWindowDays] = useState<number | ''>(existing?.deadlineWindowDays ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async () => {
    setError('')
    if (!name.trim()) { setError('Name is required.'); return }
    if (!promptTemplate.trim()) { setError('Prompt template is required.'); return }
    if (triggerType === 'schedule' && !triggerCron.trim()) { setError('Cron expression is required for schedule triggers.'); return }
    if (triggerType === 'event' && !triggerEvent) { setError('Event type is required for event triggers.'); return }

    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        triggerType,
        triggerCron: triggerType === 'schedule' ? triggerCron.trim() : null,
        triggerEvent: triggerType === 'event' ? triggerEvent : null,
        promptTemplate: promptTemplate.trim(),
        actionType,
        actionConfig,
        catchUpEnabled: triggerType === 'schedule' ? catchUpEnabled : false,
        storePayloads,
        deadlineWindowDays: triggerEvent === 'deadline_approaching' && deadlineWindowDays !== '' ? Number(deadlineWindowDays) : null,
      })
    } catch {
      setError('Failed to save automation.')
    } finally {
      setSaving(false)
    }
  }, [name, description, triggerType, triggerCron, triggerEvent, promptTemplate, actionType, actionConfig, catchUpEnabled, storePayloads, deadlineWindowDays, onSave])

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-tertiary">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="e.g. Daily Briefing"
          maxLength={100}
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-tertiary">Description (optional)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
          placeholder="What does this automation do?"
          maxLength={500}
        />
      </div>

      {/* Trigger */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-tertiary">Trigger</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
          className={inputClass}
        >
          {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Schedule-specific */}
        {triggerType === 'schedule' && (
          <div className="mt-2 space-y-2">
            <input
              value={triggerCron}
              onChange={(e) => setTriggerCron(e.target.value)}
              className={inputClass}
              placeholder="Cron expression (e.g. 0 9 * * 1-5)"
            />
            <p className="text-[11px] text-text-tertiary">
              5-field cron: minute hour day-of-month month day-of-week. Evaluated in local time.
            </p>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={catchUpEnabled}
                onChange={(e) => setCatchUpEnabled(e.target.checked)}
                className="h-3 w-3 rounded border-border accent-accent"
              />
              Run once at startup if missed
            </label>
          </div>
        )}

        {/* Event-specific */}
        {triggerType === 'event' && (
          <div className="mt-2 space-y-2">
            <select
              value={triggerEvent ?? ''}
              onChange={(e) => setTriggerEvent(e.target.value ? e.target.value as AutomationTriggerEvent : null)}
              className={inputClass}
            >
              <option value="">Select event...</option>
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {triggerEvent === 'deadline_approaching' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={deadlineWindowDays}
                  onChange={(e) => setDeadlineWindowDays(e.target.value ? Number(e.target.value) : '')}
                  className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text-primary"
                  placeholder="3"
                />
                <span className="text-xs text-text-tertiary">days before deadline</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prompt template */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-tertiary">Prompt Template</label>
        <textarea
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          className={`${inputClass} min-h-[100px] resize-y`}
          placeholder="Write the prompt that will be sent to the AI..."
          maxLength={20000}
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {['domain_name', 'event_type', 'event_data', 'current_date'].map((v) => (
            <button
              key={v}
              onClick={() => setPromptTemplate((p) => `${p}{{${v}}}`)}
              className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary hover:text-accent"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>

      {/* Action */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-tertiary">Action</label>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value as AutomationActionType)}
          className={inputClass}
        >
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {actionType === 'draft_gmail' && (
          <p className="mt-1 text-[11px] text-warning">
            Requires Gmail compose permission. If not authorized, runs will fail with &quot;missing_oauth_scope&quot;.
          </p>
        )}
      </div>

      {/* Privacy */}
      <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={storePayloads}
          onChange={(e) => setStorePayloads(e.target.checked)}
          className="h-3 w-3 rounded border-border accent-accent"
        />
        Store full prompts and responses (default: hashes only)
      </label>

      {/* Error */}
      {error && <p className="text-xs text-danger">{error}</p>}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className={primaryButtonClass}>
          {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
