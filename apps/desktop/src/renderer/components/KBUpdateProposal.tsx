import type { KBUpdateProposal as Proposal } from '../../preload/api'

interface Props {
  proposal: Proposal
  index: number
  onAccept(index: number): void
  onDismiss(index: number): void
}

const actionStyles = {
  create: { pill: 'bg-success/15 text-success', label: 'CREATE' },
  update: { pill: 'bg-warning/15 text-warning', label: 'UPDATE' },
  delete: { pill: 'bg-danger/15 text-danger', label: 'DELETE' },
}

export function KBUpdateProposal({ proposal, index, onAccept, onDismiss }: Props): React.JSX.Element {
  const style = actionStyles[proposal.action]

  return (
    <div className="mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${style.pill}`}>
          {style.label}
        </span>
        <span className="text-text-primary">{proposal.file}</span>
      </div>
      <p className="mb-2 text-xs text-text-tertiary">{proposal.reasoning}</p>

      {proposal.content && (
        <pre className="mb-2 max-h-32 overflow-y-auto rounded border border-border-subtle bg-surface-0 p-2 font-mono text-xs text-text-secondary">
          {proposal.content.slice(0, 500)}
          {proposal.content.length > 500 ? '...' : ''}
        </pre>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onAccept(index)}
          className="rounded border border-success/30 px-2 py-1 text-xs text-success hover:bg-success/10"
        >
          Accept
        </button>
        <button
          onClick={() => onDismiss(index)}
          className="rounded px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
