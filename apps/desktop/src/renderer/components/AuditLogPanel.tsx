import { useEffect } from 'react'
import { useAuditStore } from '../stores'
import { CollapsibleSection } from './CollapsibleSection'

interface Props {
  domainId: string
}

const EVENT_COLORS: Record<string, string> = {
  kb_update: 'bg-accent/15 text-accent',
  session_start: 'bg-success/15 text-success',
  session_end: 'bg-success/15 text-success',
  decision: 'bg-warning/15 text-warning',
  escalation: 'bg-danger/15 text-danger',
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function AuditLogPanel({ domainId }: Props): React.JSX.Element {
  const { entries, fetchEntries } = useAuditStore()

  useEffect(() => {
    fetchEntries(domainId, 50)
  }, [domainId, fetchEntries])

  return (
    <CollapsibleSection title="Audit Log" count={entries.length} defaultOpen={false}>
      {entries.length === 0 && (
        <p className="text-xs text-text-tertiary">No audit entries.</p>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className="mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${
                EVENT_COLORS[entry.eventType] ?? 'bg-surface-3 text-text-tertiary'
              }`}
            >
              {entry.eventType}
            </span>
            <span className="ml-auto text-[0.6rem] text-text-tertiary">
              {relativeTime(entry.createdAt)}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-text-secondary">{entry.changeDescription}</p>
        </div>
      ))}
    </CollapsibleSection>
  )
}
