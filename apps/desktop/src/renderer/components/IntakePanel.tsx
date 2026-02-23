import { useEffect, useState } from 'react'
import { useIntakeStore, useDomainStore } from '../stores'
import type { IntakeItem } from '../../preload/api'

function StatusPill({ status }: { status: IntakeItem['status'] }): React.JSX.Element {
  const styles: Record<string, string> = {
    pending: 'bg-surface-3 text-text-secondary',
    classified: 'bg-warning/20 text-warning',
    ingested: 'bg-success/20 text-success',
    dismissed: 'bg-surface-3 text-text-tertiary',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? ''}`}>
      {status}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: number }): React.JSX.Element {
  const pct = Math.round(confidence * 100)
  const color = confidence >= 0.7 ? 'text-success' : confidence >= 0.4 ? 'text-warning' : 'text-danger'
  return <span className={`text-xs font-mono ${color}`}>{pct}%</span>
}

function IntakeItemCard({
  item,
  onClassify,
  onConfirm,
  onDismiss,
}: {
  item: IntakeItem
  onClassify: (id: string) => void
  onConfirm: (id: string, domainId: string) => void
  onDismiss: (id: string) => void
}): React.JSX.Element {
  const { domains } = useDomainStore()
  const [overrideDomainId, setOverrideDomainId] = useState(item.suggestedDomainId ?? '')
  const [classifying, setClassifying] = useState(false)

  const suggestedDomain = domains.find((d) => d.id === item.suggestedDomainId)

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-text-primary">{item.title}</h3>
            <StatusPill status={item.status} />
          </div>
          {item.sourceUrl && (
            <p className="mt-0.5 truncate text-xs text-text-tertiary">{item.sourceUrl}</p>
          )}
        </div>
        <span className="shrink-0 text-xs text-text-tertiary">
          {(item.contentSizeBytes / 1024).toFixed(1)} KB
        </span>
      </div>

      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-secondary">
        {item.content.slice(0, 200)}
        {item.content.length > 200 ? '...' : ''}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {item.status === 'pending' && (
          <button
            onClick={async () => {
              setClassifying(true)
              await onClassify(item.id)
              setClassifying(false)
            }}
            disabled={classifying}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {classifying ? 'Classifying...' : 'Classify'}
          </button>
        )}

        {item.status === 'classified' && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span>Suggested:</span>
              <span className="font-medium text-text-primary">{suggestedDomain?.name ?? 'Unknown'}</span>
              {item.confidence !== null && <ConfidenceBadge confidence={item.confidence} />}
            </div>

            <select
              value={overrideDomainId}
              onChange={(e) => setOverrideDomainId(e.target.value)}
              className="ml-auto rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-secondary"
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => onConfirm(item.id, overrideDomainId || item.suggestedDomainId || '')}
              className="rounded bg-success/20 px-3 py-1 text-xs font-medium text-success hover:bg-success/30"
            >
              Confirm
            </button>
          </>
        )}

        <button
          onClick={() => onDismiss(item.id)}
          className="rounded px-3 py-1 text-xs text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

export function IntakePanel(): React.JSX.Element {
  const { items, loading, fetchPending, classifyItem, confirmItem, dismissItem } = useIntakeStore()

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Intake</h2>
        <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium text-accent-text">
          {items.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="mx-auto mt-12 max-w-sm rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-text-tertiary">No pending intake items.</p>
            <p className="mt-1 text-xs text-text-tertiary">
              Send content from the Chrome Extension to see items here.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <IntakeItemCard
              key={item.id}
              item={item}
              onClassify={(id) => classifyItem(id)}
              onConfirm={confirmItem}
              onDismiss={dismissItem}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
