/**
 * Gate approval dialog — blocking overlay when a mission run
 * requests permission to execute side effects.
 */

interface Props {
  message: string
  outputs: { alerts: number; actions: number; monitors: number }
  pendingActions: string[]
  onApprove: () => void
  onReject: () => void
}

const OctagonIcon = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M5.27 1h5.46L15 5.27v5.46L10.73 15H5.27L1 10.73V5.27L5.27 1Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M8 5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="10.5" r="0.75" fill="currentColor" />
  </svg>
)

export function MissionGateModal({
  message,
  outputs,
  pendingActions,
  onApprove,
  onReject,
}: Props): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg border-2 border-amber-500/60 bg-surface-1 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center gap-2 text-amber-400">
          <OctagonIcon />
          <span className="text-sm font-semibold">Approval Required</span>
        </div>

        {/* Message */}
        <p className="mb-4 text-sm text-text-primary">{message}</p>

        {/* Output summary */}
        <div className="mb-4 rounded border border-border bg-surface-0 p-3">
          <p className="mb-1 text-xs font-medium text-text-secondary">Analysis produced:</p>
          <div className="flex gap-4 text-xs text-text-tertiary">
            {outputs.alerts > 0 && <span>{outputs.alerts} alert(s)</span>}
            {outputs.actions > 0 && <span>{outputs.actions} action(s)</span>}
            {outputs.monitors > 0 && <span>{outputs.monitors} monitor(s)</span>}
          </div>
        </div>

        {/* Pending actions */}
        {pendingActions.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 text-xs font-medium text-text-secondary">Pending side effects:</p>
            <ul className="space-y-1">
              {pendingActions.map((action, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 rounded border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-2"
          >
            Skip Actions
          </button>
          <button
            onClick={onApprove}
            className="flex-1 rounded bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
