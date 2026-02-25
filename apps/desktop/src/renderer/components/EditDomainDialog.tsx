import { useState, useEffect } from 'react'
import { useDomainStore, useTagStore } from '../stores'
import type { Domain } from '../../preload/api'
import { SiblingSelector } from './SiblingSelector'
import { TagInput } from './TagInput'
import { inputClass, primaryButtonClass, secondaryButtonClass } from './ui'

const PREDEFINED_TAG_KEYS = ['property', 'contact', 'type'] as const

interface Props {
  domain: Domain
  onClose(): void
}

export function EditDomainDialog({ domain, onClose }: Props): React.JSX.Element {
  const { updateDomain } = useDomainStore()
  const { tagsByDomain, fetchAllTags, fetchDistinctValues, setTagsForDomain } = useTagStore()
  const [name, setName] = useState(domain.name)
  const [description, setDescription] = useState(domain.description)
  const [kbPath, setKbPath] = useState(domain.kbPath)
  const [identity, setIdentity] = useState(domain.identity ?? '')
  const [escalationTriggers, setEscalationTriggers] = useState(domain.escalationTriggers ?? '')
  const [submitting, setSubmitting] = useState(false)

  // Tag state — keyed by tag key, values are arrays of strings
  const [tagValues, setTagValues] = useState<Record<string, string[]>>({})
  // Custom tags: array of {key, value} for non-predefined keys
  const [customTags, setCustomTags] = useState<Array<{ key: string; value: string }>>([])
  const [newCustomKey, setNewCustomKey] = useState('')
  const [newCustomValue, setNewCustomValue] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  // Suggestions per key
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})

  // Load tags on mount
  useEffect(() => {
    fetchAllTags().then(() => {
      const domainTags = tagsByDomain[domain.id] ?? []

      // Split into predefined vs custom
      const predefined: Record<string, string[]> = {}
      const custom: Array<{ key: string; value: string }> = []

      for (const tag of domainTags) {
        if ((PREDEFINED_TAG_KEYS as readonly string[]).includes(tag.key)) {
          if (!predefined[tag.key]) predefined[tag.key] = []
          predefined[tag.key].push(tag.value)
        } else {
          custom.push({ key: tag.key, value: tag.value })
        }
      }

      setTagValues(predefined)
      setCustomTags(custom)
      if (custom.length > 0) setShowCustom(true)
    })

    // Fetch suggestions for predefined keys
    for (const key of PREDEFINED_TAG_KEYS) {
      fetchDistinctValues(key).then((vals) => {
        setSuggestions((prev) => ({ ...prev, [key]: vals.map((v) => v.value) }))
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePickFolder(): Promise<void> {
    const result = await window.domainOS.dialog.openFolder()
    if (result.ok && result.value) {
      setKbPath(result.value)
    }
  }

  function addCustomTag(): void {
    const key = newCustomKey.trim().toLowerCase()
    const value = newCustomValue.trim()
    if (!key || !value) return
    if (!/^[a-z][a-z0-9_-]*$/.test(key) || key.length > 32) return
    setCustomTags([...customTags, { key, value }])
    setNewCustomKey('')
    setNewCustomValue('')
  }

  function removeCustomTag(index: number): void {
    setCustomTags(customTags.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!name.trim() || !kbPath.trim()) return

    setSubmitting(true)

    // Build flat tag array from predefined + custom
    const allTags: Array<{ key: string; value: string }> = []
    for (const key of PREDEFINED_TAG_KEYS) {
      for (const val of tagValues[key] ?? []) {
        allTags.push({ key, value: val })
      }
    }
    for (const ct of customTags) {
      allTags.push({ key: ct.key, value: ct.value })
    }

    // Save domain + tags in parallel
    const [success] = await Promise.all([
      updateDomain(domain.id, {
        name: name.trim(),
        description: description.trim(),
        kbPath: kbPath.trim(),
        identity: identity.trim(),
        escalationTriggers: escalationTriggers.trim(),
      }),
      setTagsForDomain(domain.id, allTags),
    ])
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

        {/* Tags Section */}
        <div className="mb-3 rounded border border-border/50 p-3">
          <h4 className="mb-2 text-sm font-medium text-text-secondary">Tags</h4>

          {PREDEFINED_TAG_KEYS.map((key) => (
            <TagInput
              key={key}
              label={key.charAt(0).toUpperCase() + key.slice(1)}
              values={tagValues[key] ?? []}
              suggestions={suggestions[key] ?? []}
              onChange={(vals) => setTagValues((prev) => ({ ...prev, [key]: vals }))}
            />
          ))}

          {/* Custom tags */}
          {showCustom && customTags.length > 0 && (
            <div className="mb-2">
              <span className="mb-1 block text-sm text-text-secondary">Custom Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {customTags.map((ct, i) => (
                  <span
                    key={`${ct.key}-${ct.value}-${i}`}
                    className="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-xs text-text-secondary"
                  >
                    <span className="font-medium">{ct.key}:</span> {ct.value}
                    <button
                      type="button"
                      onClick={() => removeCustomTag(i)}
                      className="text-text-tertiary hover:text-text-primary ml-0.5"
                      aria-label={`Remove ${ct.key}: ${ct.value}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowCustom(!showCustom)}
            className="text-xs text-accent-text hover:underline"
          >
            {showCustom ? 'Hide custom tags' : '+ Add custom tag'}
          </button>

          {showCustom && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={newCustomKey}
                onChange={(e) => setNewCustomKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                className={`w-28 ${inputClass}`}
                placeholder="key"
                maxLength={32}
              />
              <input
                type="text"
                value={newCustomValue}
                onChange={(e) => setNewCustomValue(e.target.value)}
                className={`flex-1 ${inputClass}`}
                placeholder="value"
                maxLength={128}
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!newCustomKey || !newCustomValue.trim()}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          )}
        </div>

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
