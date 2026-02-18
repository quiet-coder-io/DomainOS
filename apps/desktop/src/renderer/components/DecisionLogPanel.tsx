import { useEffect, useState } from 'react'
import { useDecisionStore } from '../stores'
import { CollapsibleSection } from './CollapsibleSection'

interface Props {
  domainId: string
}

export function DecisionLogPanel({ domainId }: Props): React.JSX.Element {
  const { decisions, fetchActive, reject } = useDecisionStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetchActive(domainId)
  }, [domainId, fetchActive])

  return (
    <CollapsibleSection title="Decisions" count={decisions.length} defaultOpen={false}>
      {decisions.length === 0 && (
        <p className="text-xs text-text-tertiary">No active decisions.</p>
      )}

      {decisions.map((d) => {
        const expanded = expandedId === d.id
        return (
          <div key={d.id} className="mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : d.id)}
              className="flex w-full items-start gap-2 text-left"
            >
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[0.65rem] font-mono font-medium text-accent">
                {d.decisionId}
              </span>
              <span className="flex-1 truncate text-xs text-text-primary">{d.decision}</span>
            </button>

            {expanded && (
              <div className="mt-2 space-y-2 text-xs animate-fade-in">
                {d.rationale && (
                  <div>
                    <span className="font-medium text-text-secondary">Rationale:</span>
                    <p className="mt-0.5 text-text-tertiary">{d.rationale}</p>
                  </div>
                )}
                {d.downside && (
                  <div>
                    <span className="font-medium text-text-secondary">Downside:</span>
                    <p className="mt-0.5 text-text-tertiary">{d.downside}</p>
                  </div>
                )}
                {d.revisitTrigger && (
                  <div>
                    <span className="font-medium text-text-secondary">Revisit trigger:</span>
                    <p className="mt-0.5 text-text-tertiary">{d.revisitTrigger}</p>
                  </div>
                )}
                {d.linkedFiles.length > 0 && (
                  <div>
                    <span className="font-medium text-text-secondary">Linked files:</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {d.linkedFiles.map((f) => (
                        <span key={f} className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.6rem] text-text-tertiary">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {d.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => reject(d.id)}
                    className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                  >
                    Reject
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </CollapsibleSection>
  )
}
