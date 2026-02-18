import { useEffect, useState } from 'react'
import { useDomainStore, useRelationshipStore } from '../stores'

interface Props {
  domainId: string
}

export function SiblingSelector({ domainId }: Props): React.JSX.Element {
  const { domains } = useDomainStore()
  const { siblings, fetchSiblings, addSibling, removeSibling } = useRelationshipStore()
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    fetchSiblings(domainId)
  }, [domainId, fetchSiblings])

  const siblingDomainIds = new Set(siblings.map((s) => s.siblingDomainId))
  const availableDomains = domains.filter((d) => d.id !== domainId && !siblingDomainIds.has(d.id))

  async function handleAdd(): Promise<void> {
    if (!selectedId) return
    await addSibling(domainId, selectedId)
    setSelectedId('')
  }

  return (
    <div className="mb-3">
      <span className="mb-1 block text-sm text-text-secondary">Sibling Domains</span>

      {siblings.length === 0 && (
        <p className="mb-2 text-xs text-text-tertiary">No sibling domains linked.</p>
      )}

      {siblings.map((s) => {
        const siblingDomain = domains.find((d) => d.id === s.siblingDomainId)
        return (
          <div key={s.id} className="mb-1 flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-1.5 animate-fade-in">
            <span className="flex-1 text-sm text-text-primary">
              {siblingDomain?.name ?? s.siblingDomainId}
            </span>
            <button
              type="button"
              onClick={() => removeSibling(domainId, s.siblingDomainId)}
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
        <div className="mt-2 flex gap-2">
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
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedId}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
