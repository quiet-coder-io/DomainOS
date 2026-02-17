import { useEffect, useState } from 'react'
import { useDomainStore } from '../stores'
import { CreateDomainDialog } from './CreateDomainDialog'

export function Sidebar(): React.JSX.Element {
  const { domains, activeDomainId, loading, fetchDomains, setActiveDomain } = useDomainStore()
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-secondary">Domains</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
        >
          + New
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {loading && domains.length === 0 && (
          <div className="flex items-center justify-center px-2 py-6">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {!loading && domains.length === 0 && (
          <div className="mx-2 my-4 rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-xs text-text-tertiary">
              No domains yet.
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Create one to get started.
            </p>
          </div>
        )}
        {domains.map((domain) => {
          const isActive = activeDomainId === domain.id
          return (
            <button
              key={domain.id}
              onClick={() => setActiveDomain(domain.id)}
              className={`mb-1 flex w-full items-start gap-2 rounded px-3 py-2 text-left text-sm ${
                isActive
                  ? 'bg-accent-muted text-accent-text'
                  : 'text-text-secondary hover:bg-surface-2'
              }`}
            >
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  isActive ? 'bg-accent' : 'bg-text-tertiary'
                }`}
              />
              <div className="min-w-0">
                <div className="font-medium">{domain.name}</div>
                {domain.description && (
                  <div className="mt-0.5 truncate text-xs text-text-tertiary">{domain.description}</div>
                )}
              </div>
            </button>
          )
        })}
      </nav>

      {showCreate && <CreateDomainDialog onClose={() => setShowCreate(false)} />}
    </aside>
  )
}
