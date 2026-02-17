import { useState } from 'react'
import { useDomainStore } from '../stores'

interface Props {
  onClose(): void
}

export function CreateDomainDialog({ onClose }: Props): React.JSX.Element {
  const { createDomain, setActiveDomain } = useDomainStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kbPath, setKbPath] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handlePickFolder(): Promise<void> {
    const result = await window.domainOS.dialog.openFolder()
    if (result.ok && result.value) {
      setKbPath(result.value)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim() || !kbPath.trim()) return

    setSubmitting(true)
    const domain = await createDomain({
      name: name.trim(),
      description: description.trim(),
      kbPath: kbPath.trim(),
    })
    setSubmitting(false)

    if (domain) {
      setActiveDomain(domain.id)
      onClose()
    }
  }

  const inputClass =
    'w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-6"
      >
        <h3 className="mb-4 text-lg font-semibold text-text-primary">Create Domain</h3>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Real Estate"
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="What is this domain about?"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-text-secondary">Knowledge Base Folder</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={kbPath}
              onChange={(e) => setKbPath(e.target.value)}
              className={`flex-1 ${inputClass}`}
              placeholder="/path/to/kb"
              readOnly
            />
            <button
              type="button"
              onClick={handlePickFolder}
              className="rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-3"
            >
              Browse
            </button>
          </div>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kbPath.trim()}
            className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
