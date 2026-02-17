import type { KBUpdateProposal as Proposal } from '../../preload/api'

interface Props {
  proposal: Proposal
  index: number
  onAccept(index: number): void
  onDismiss(index: number): void
}

export function KBUpdateProposal({ proposal, index, onAccept, onDismiss }: Props): React.JSX.Element {
  const actionColors = {
    create: 'text-green-400',
    update: 'text-yellow-400',
    delete: 'text-red-400',
  }

  return (
    <div className="mb-2 rounded border border-neutral-700 bg-neutral-800 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className={`font-medium ${actionColors[proposal.action]}`}>
          {proposal.action.toUpperCase()}
        </span>
        <span className="text-neutral-300">{proposal.file}</span>
      </div>
      <p className="mb-2 text-xs text-neutral-400">{proposal.reasoning}</p>

      {proposal.content && (
        <pre className="mb-2 max-h-32 overflow-y-auto rounded bg-neutral-900 p-2 text-xs text-neutral-300">
          {proposal.content.slice(0, 500)}
          {proposal.content.length > 500 ? '...' : ''}
        </pre>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onAccept(index)}
          className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
        >
          Accept
        </button>
        <button
          onClick={() => onDismiss(index)}
          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-600"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
