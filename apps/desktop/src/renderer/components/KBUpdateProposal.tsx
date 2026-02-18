import { useState, useRef } from 'react'
import type { KBUpdateProposal as Proposal } from '../../preload/api'

interface StoredProposal extends Proposal {
  localId: string
  source: 'chat-send' | 'extract'
  sourceMessageIndex?: number
  isEdited?: boolean
}

interface Props {
  proposal: StoredProposal
  onAccept(id: string): void
  onDismiss(id: string): void
  onEdit(id: string, newContent: string): void
}

const actionStyles = {
  create: { pill: 'bg-success/15 text-success', label: 'CREATE' },
  update: { pill: 'bg-warning/15 text-warning', label: 'UPDATE' },
  delete: { pill: 'bg-danger/15 text-danger', label: 'DELETE' },
}

export function KBUpdateProposal({ proposal, onAccept, onDismiss, onEdit }: Props): React.JSX.Element {
  const style = actionStyles[proposal.action]
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const originalContentRef = useRef('')

  function handleEdit(): void {
    originalContentRef.current = proposal.content
    setEditContent(proposal.content)
    setIsEditing(true)
  }

  function handleSave(): void {
    onEdit(proposal.localId, editContent)
    setIsEditing(false)
  }

  function handleCancel(): void {
    setEditContent(originalContentRef.current)
    setIsEditing(false)
  }

  return (
    <div className="mb-2 rounded border border-border bg-surface-2 p-3 animate-fade-in">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${style.pill}`}>
          {style.label}
        </span>
        <span className="truncate text-text-primary">{proposal.file}</span>
        {proposal.isEdited && (
          <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[0.6rem] text-accent">
            edited
          </span>
        )}
        {proposal.source === 'extract' && (
          <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[0.6rem] text-accent">
            Extracted
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-text-tertiary">{proposal.reasoning}</p>

      {/* Content preview / edit */}
      {isEditing ? (
        <div className="mb-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            spellCheck={false}
            className="w-full max-h-96 rounded border border-border-subtle bg-surface-0 p-2 font-mono text-xs text-text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            style={{ whiteSpace: 'pre', overflowWrap: 'normal' }}
            rows={Math.min(20, (editContent.match(/\n/g) || []).length + 3)}
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={handleSave}
              className="rounded border border-accent/30 px-2 py-1 text-xs text-accent hover:bg-accent/10"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {proposal.content && (
            <pre className="mb-2 max-h-32 overflow-y-auto rounded border border-border-subtle bg-surface-0 p-2 font-mono text-xs text-text-secondary">
              {proposal.content.slice(0, 500)}
              {proposal.content.length > 500 ? '...' : ''}
            </pre>
          )}
        </>
      )}

      <div className="flex gap-2">
        {!isEditing && (
          <>
            <button
              onClick={() => onAccept(proposal.localId)}
              className="rounded border border-success/30 px-2 py-1 text-xs text-success hover:bg-success/10"
            >
              Accept
            </button>
            <button
              onClick={handleEdit}
              className="rounded border border-border px-2 py-1 text-xs text-text-tertiary hover:bg-surface-0 hover:text-text-secondary"
            >
              Edit
            </button>
            <button
              onClick={() => onDismiss(proposal.localId)}
              className="rounded px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  )
}
