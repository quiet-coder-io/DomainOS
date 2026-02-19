import { useEffect, useState } from 'react'
import { useDomainStore, useRelationshipStore } from '../stores'
import type { DependencyType } from '../../preload/api'

const DEPENDENCY_LABELS: Record<DependencyType, string> = {
  blocks: 'Blocks',
  depends_on: 'Depends on',
  informs: 'Informs',
  parallel: 'Parallel',
  monitor_only: 'Monitor only',
}

const DEP_BADGE_COLORS: Record<DependencyType, string> = {
  blocks: 'bg-red-500/20 text-red-400',
  depends_on: 'bg-amber-500/20 text-amber-400',
  informs: 'bg-blue-500/20 text-blue-400',
  parallel: 'bg-green-500/20 text-green-400',
  monitor_only: 'bg-gray-500/20 text-gray-400',
}

interface Props {
  domainId: string
}

export function SiblingSelector({ domainId }: Props): React.JSX.Element {
  const { domains } = useDomainStore()
  const { relationships, fetchRelationships, addRelationship, removeRelationship, removeSibling } = useRelationshipStore()

  const [selectedId, setSelectedId] = useState('')
  const [depType, setDepType] = useState<DependencyType>('informs')
  const [description, setDescription] = useState('')
  const [reciprocate, setReciprocate] = useState(false)
  const [reciprocalType, setReciprocalType] = useState<DependencyType>('informs')

  useEffect(() => {
    fetchRelationships(domainId)
  }, [domainId, fetchRelationships])

  // Deduplicate reciprocated pairs for display by displayKey
  const seen = new Set<string>()
  const deduped = relationships.filter((r) => {
    if (seen.has(r.displayKey)) return false
    seen.add(r.displayKey)
    return true
  })

  // For the dropdown, exclude domains already linked (in either direction)
  const linkedIds = new Set(relationships.map((r) => r.peerDomainId))
  const availableDomains = domains.filter((d) => d.id !== domainId && !linkedIds.has(d.id))

  async function handleAdd(): Promise<void> {
    if (!selectedId) return
    await addRelationship(domainId, selectedId, {
      dependencyType: depType,
      description: description.trim(),
      reciprocate,
      reciprocalType: reciprocate ? reciprocalType : undefined,
    })
    setSelectedId('')
    setDescription('')
    setDepType('informs')
    setReciprocate(false)
    setReciprocalType('informs')
  }

  async function handleRemove(peerId: string): Promise<void> {
    // Remove both directions for clean removal
    await removeSibling(domainId, peerId)
    await fetchRelationships(domainId)
  }

  return (
    <div className="mb-3">
      <span className="mb-1 block text-sm text-text-secondary">Domain Relationships</span>

      {deduped.length === 0 && (
        <p className="mb-2 text-xs text-text-tertiary">No domain relationships configured.</p>
      )}

      {deduped.map((r) => {
        const directionArrow = r.perspective === 'outgoing' ? '→' : '←'
        const badgeColor = DEP_BADGE_COLORS[r.dependencyType] ?? DEP_BADGE_COLORS.informs

        // Check if reciprocal exists
        const hasReciprocal = relationships.some(
          (other) =>
            other.id !== r.id &&
            other.peerDomainId === r.peerDomainId &&
            other.perspective !== r.perspective,
        )

        return (
          <div
            key={r.displayKey}
            className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-1.5 animate-fade-in"
          >
            <span className="text-xs text-text-tertiary" title={r.perspective}>
              {hasReciprocal ? '↔' : directionArrow}
            </span>
            <span className="flex-1 text-sm text-text-primary">{r.peerDomainName}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}>
              {DEPENDENCY_LABELS[r.dependencyType]}
            </span>
            {r.description && (
              <span className="max-w-[120px] truncate text-[10px] text-text-tertiary" title={r.description}>
                {r.description}
              </span>
            )}
            <button
              type="button"
              onClick={() => handleRemove(r.peerDomainId)}
              className="text-text-tertiary hover:text-danger"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}

      {availableDomains.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            >
              <option value="">Select domain...</option>
              {availableDomains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={depType}
              onChange={(e) => setDepType(e.target.value as DependencyType)}
              className="rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            >
              {Object.entries(DEPENDENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {selectedId && (
            <>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              />

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={reciprocate}
                    onChange={(e) => setReciprocate(e.target.checked)}
                    className="rounded border-border"
                  />
                  Reciprocate
                </label>

                {reciprocate && (
                  <select
                    value={reciprocalType}
                    onChange={(e) => setReciprocalType(e.target.value as DependencyType)}
                    className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
                  >
                    {Object.entries(DEPENDENCY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label} (reverse)</option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!selectedId}
                  className="ml-auto rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
