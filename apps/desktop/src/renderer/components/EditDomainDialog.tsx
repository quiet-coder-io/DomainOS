import { useState } from 'react'
import { useDomainStore } from '../stores'
import type { Domain } from '../../preload/api'
import { SiblingSelector } from './SiblingSelector'
import { inputClass, primaryButtonClass, secondaryButtonClass } from './ui'

interface Props {
  domain: Domain
  onClose(): void
}

export function EditDomainDialog({ domain, onClose }: Props): React.JSX.Element {
  const { updateDomain } = useDomainStore()
  const [name, setName] = useState(domain.name)
  const [description, setDescription] = useState(domain.description)
  const [kbPath, setKbPath] = useState(domain.kbPath)
  const [identity, setIdentity] = useState(domain.identity ?? '')
  const [escalationTriggers, setEscalationTriggers] = useState(domain.escalationTriggers ?? '')
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
    const success = await updateDomain(domain.id, {
      name: name.trim(),
      description: description.trim(),
      kbPath: kbPath.trim(),
      identity: identity.trim(),
      escalationTriggers: escalationTriggers.trim(),
    })
    setSubmitting(false)

    if (success) {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-border bg-surface-1 p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="mb-4 text-lg font-semibold text-text-primary">Edit Domain</h3>

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

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Agent Identity</span>
          <textarea
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            className={inputClass}
            rows={4}
            placeholder="Role, expertise, tone, and strategic thinking for this domain's agent..."
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Escalation Triggers</span>
          <textarea
            value={escalationTriggers}
            onChange={(e) => setEscalationTriggers(e.target.value)}
            className={inputClass}
            rows={3}
            placeholder="Conditions that should trigger a STOP or escalation..."
          />
        </label>

        <SiblingSelector domainId={domain.id} />

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
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !kbPath.trim()}
            className={primaryButtonClass}
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
