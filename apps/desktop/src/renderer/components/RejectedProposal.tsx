import { useState } from 'react'
import type { RejectedProposal as RejectedProposalType } from '../../preload/api'

interface StoredRejected extends RejectedProposalType {
  source: 'chat-send' | 'extract'
  sourceMessageIndex?: number
}

interface Props {
  proposal: StoredRejected
  onDismiss(id: string): void
}

export function RejectedProposal({ proposal, onDismiss }: Props): React.JSX.Element {
  const [showExcerpt, setShowExcerpt] = useState(false)

  return (
    <div className="mb-2 rounded border border-warning/40 bg-warning/5 p-3 animate-fade-in">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[0.65rem] font-medium text-warning">
          REJECTED
        </span>
        {proposal.action && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] text-text-tertiary">
            {proposal.action.toUpperCase()}
          </span>
        )}
        <span className="truncate text-text-primary">{proposal.file}</span>
      </div>

      {/* Rejection reason — prominent */}
      <p className="mb-1 text-xs font-medium text-warning">{proposal.rejectionReason}</p>

      {/* Suggested fix — hint */}
      {proposal.suggestedFix && (
        <p className="mb-1 text-xs text-text-tertiary">
          <span className="font-medium">Fix:</span> {proposal.suggestedFix}
        </p>
      )}

      {/* Reasoning if present */}
      {proposal.reasoning && (
        <p className="mb-1 text-xs text-text-tertiary italic">{proposal.reasoning}</p>
      )}

      {/* Source badge */}
      {proposal.source === 'extract' && (
        <span className="mb-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[0.6rem] text-accent">
          Extracted
        </span>
      )}

      {/* Raw excerpt — collapsible */}
      {proposal.rawExcerpt && (
        <div className="mt-1">
          <button
            onClick={() => setShowExcerpt(!showExcerpt)}
            className="text-[0.65rem] text-text-tertiary hover:text-text-secondary"
          >
            {showExcerpt ? 'Hide excerpt' : 'Show excerpt'}
          </button>
          {showExcerpt && (
            <pre className="mt-1 max-h-24 overflow-y-auto rounded border border-border-subtle bg-surface-0 p-2 font-mono text-[0.65rem] text-text-tertiary">
              {proposal.rawExcerpt}
            </pre>
          )}
        </div>
      )}

      {/* Dismiss */}
      <div className="mt-2 flex">
        <button
          onClick={() => onDismiss(proposal.id)}
          className="rounded px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
