import { useEffect, useState } from 'react'
import { useGapFlagStore } from '../stores'
import { CollapsibleSection } from './CollapsibleSection'

interface Props {
  domainId: string
}

export function GapFlagPanel({ domainId }: Props): React.JSX.Element {
  const { flags, fetchOpen, fetchAll, acknowledge, resolve } = useGapFlagStore()
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (showAll) {
      fetchAll(domainId)
    } else {
      fetchOpen(domainId)
    }
  }, [domainId, showAll, fetchOpen, fetchAll])

  return (
    <CollapsibleSection title="Gap Flags" count={flags.length} defaultOpen={false}>
      <div className="mb-2 flex gap-1">
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
            !showAll ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={`rounded px-2 py-0.5 text-[0.65rem] font-medium ${
            showAll ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          All
        </button>
      </div>

      {flags.length === 0 && (
        <p className="text-xs text-text-tertiary">No gap flags found.</p>
      )}

      {flags.map((flag) => (
        <div key={flag.id} className="mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in">
          <div className="flex items-start gap-2">
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[0.65rem] font-medium text-warning">
              {flag.category}
            </span>
            <p className="flex-1 text-xs text-text-secondary">{flag.description}</p>
          </div>
          {flag.status === 'open' && (
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => acknowledge(flag.id)}
                className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
              >
                Acknowledge
              </button>
              <button
                type="button"
                onClick={() => resolve(flag.id)}
                className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
              >
                Resolve
              </button>
            </div>
          )}
          {flag.status !== 'open' && (
            <span className="mt-1 inline-block rounded-full bg-success/15 px-2 py-0.5 text-[0.65rem] font-medium text-success">
              {flag.status}
            </span>
          )}
        </div>
      ))}
    </CollapsibleSection>
  )
}
