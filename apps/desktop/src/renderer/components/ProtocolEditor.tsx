import { useEffect, useState } from 'react'
import { useProtocolStore } from '../stores/protocol-store'
import type { Protocol } from '../../preload/api'

interface Props {
  domainId: string
}

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block">
    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const EditIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.5 1.5l1 1-5.5 5.5H2V7L7.5 1.5z" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

const TrashIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 3h6M3.5 3V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5V3M3.5 3v5a.5.5 0 00.5.5h2a.5.5 0 00.5-.5V3" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

function ProtocolForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; content: string }
  onSave: (name: string, content: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [content, setContent] = useState(initial?.content ?? '')

  return (
    <div className="space-y-2 rounded border border-border bg-surface-2 p-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Protocol name"
        className="w-full rounded border border-border bg-surface-0 px-2 py-1 text-xs text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none"
        autoFocus
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Protocol instructions..."
        rows={4}
        className="w-full resize-y rounded border border-border bg-surface-0 px-2 py-1 text-xs text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (name.trim() && content.trim()) onSave(name.trim(), content.trim())
          }}
          disabled={!name.trim() || !content.trim()}
          className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent/80 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ProtocolItem({
  protocol,
  onUpdate,
  onDelete,
}: {
  protocol: Protocol
  onUpdate: (id: string, input: { name: string; content: string }) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ProtocolForm
        initial={{ name: protocol.name, content: protocol.content }}
        onSave={(name, content) => {
          onUpdate(protocol.id, { name, content })
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="group flex items-start gap-1.5 border-b border-border-subtle/50 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-primary">{protocol.name}</div>
        <div className="mt-0.5 line-clamp-2 text-[0.65rem] text-text-tertiary">{protocol.content}</div>
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          className="rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
          title="Edit"
        >
          <EditIcon />
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete protocol "${protocol.name}"?`)) {
              onDelete(protocol.id)
            }
          }}
          className="rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-danger"
          title="Delete"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

export function ProtocolEditor({ domainId }: Props): React.JSX.Element {
  const { protocols, fetchProtocols, createProtocol, updateProtocol, deleteProtocol } =
    useProtocolStore()
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetchProtocols(domainId)
  }, [domainId, fetchProtocols])

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-secondary">Protocols</h3>
        <button
          onClick={() => setAdding(true)}
          className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
          title="Add Protocol"
        >
          <PlusIcon />
        </button>
      </div>

      {adding && (
        <ProtocolForm
          onSave={async (name, content) => {
            await createProtocol({ domainId, name, content })
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {protocols.length === 0 && !adding && (
        <p className="text-xs text-text-tertiary">
          No protocols. Add one to guide domain behavior.
        </p>
      )}

      {protocols.map((p) => (
        <ProtocolItem
          key={p.id}
          protocol={p}
          onUpdate={(id, input) => updateProtocol(id, input)}
          onDelete={(id) => deleteProtocol(id)}
        />
      ))}
    </div>
  )
}
