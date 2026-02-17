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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6"
      >
        <h3 className="mb-4 text-lg font-semibold text-neutral-100">Create Domain</h3>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-neutral-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
            placeholder="e.g. Real Estate"
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-neutral-400">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
            rows={2}
            placeholder="What is this domain about?"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-neutral-400">Knowledge Base Folder</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={kbPath}
              onChange={(e) => setKbPath(e.target.value)}
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
              placeholder="/path/to/kb"
              readOnly
            />
            <button
              type="button"
              onClick={handlePickFolder}
              className="rounded border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
            >
              Browse
            </button>
          </div>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kbPath.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
