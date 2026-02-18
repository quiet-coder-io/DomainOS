import { useState } from 'react'
import { useDomainStore } from '../stores'
import { inputClass, primaryButtonClass, secondaryButtonClass } from './ui'

interface Props {
  mode: 'add' | 'create'
  onClose(): void
}

export function CreateDomainDialog({ mode, onClose }: Props): React.JSX.Element {
  const { createDomain, setActiveDomain } = useDomainStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kbPath, setKbPath] = useState('')
  const [identity, setIdentity] = useState('')
  const [escalationTriggers, setEscalationTriggers] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [scaffoldFeedback, setScaffoldFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    setScaffoldFeedback(null)

    // In "create" mode, scaffold KB files first
    if (mode === 'create') {
      const scaffoldResult = await window.domainOS.kb.scaffold({
        dirPath: kbPath.trim(),
        domainName: name.trim(),
      })
      if (!scaffoldResult.ok) {
        setError(scaffoldResult.error ?? 'Failed to scaffold KB files')
        setSubmitting(false)
        return
      }

      const created = scaffoldResult.value!.files.filter((f) => f.status === 'created').map((f) => f.filename)
      const skipped = scaffoldResult.value!.files.filter((f) => f.status === 'skipped').map((f) => f.filename)
      if (scaffoldResult.value!.skippedCount === 3) {
        setScaffoldFeedback('All KB files already exist; nothing was overwritten.')
      } else {
        const parts: string[] = []
        if (created.length) parts.push(`created ${created.join(', ')}`)
        if (skipped.length) parts.push(`skipped ${skipped.join(', ')}`)
        setScaffoldFeedback(`Scaffolded KB: ${parts.join('; ')}`)
      }
    }

    const domain = await createDomain({
      name: name.trim(),
      description: description.trim(),
      kbPath: kbPath.trim(),
      identity: identity.trim(),
      escalationTriggers: escalationTriggers.trim(),
    })

    if (domain) {
      // Trigger initial KB scan so files are in DB before KBFileList mounts
      await window.domainOS.kb.scan(domain.id)
      setActiveDomain(domain.id)
      onClose()
    } else {
      setError('Failed to create domain')
    }

    setSubmitting(false)
  }

  const title = mode === 'create' ? 'Create New Domain' : 'Add Existing KB'
  const submitLabel = mode === 'create'
    ? (submitting ? 'Creating...' : 'Create')
    : (submitting ? 'Adding...' : 'Add')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-border bg-surface-1 p-6 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="mb-4 text-lg font-semibold text-text-primary">{title}</h3>

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
          <span className="mb-1 block text-sm text-text-secondary">Agent Identity (optional)</span>
          <textarea
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            className={inputClass}
            rows={4}
            placeholder="Role, expertise, tone, and strategic thinking for this domain's agent..."
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">Escalation Triggers (optional)</span>
          <textarea
            value={escalationTriggers}
            onChange={(e) => setEscalationTriggers(e.target.value)}
            className={inputClass}
            rows={3}
            placeholder="Conditions that should trigger a STOP or escalation..."
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-text-secondary">
            {mode === 'create' ? 'Target Folder (KB files will be created here)' : 'Knowledge Base Folder'}
          </span>
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
          {mode === 'create' && (
            <p className="mt-1 text-xs text-text-tertiary">
              Three KB files (claude.md, kb_digest.md, kb_intel.md) will be created here. Existing files won&apos;t be overwritten.
            </p>
          )}
        </label>

        {error && (
          <p className="mb-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        {scaffoldFeedback && (
          <p className="mb-3 rounded bg-green-500/10 px-3 py-2 text-xs text-green-400">{scaffoldFeedback}</p>
        )}

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
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
