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
    <aside className="flex h-full w-64 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-300">Domains</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
        >
          + New
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {loading && domains.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-neutral-500">Loading...</p>
        )}
        {!loading && domains.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-neutral-500">
            No domains yet. Create one to get started.
          </p>
        )}
        {domains.map((domain) => (
          <button
            key={domain.id}
            onClick={() => setActiveDomain(domain.id)}
            className={`mb-1 w-full rounded px-3 py-2 text-left text-sm transition-colors ${
              activeDomainId === domain.id
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            <div className="font-medium">{domain.name}</div>
            {domain.description && (
              <div className="mt-0.5 truncate text-xs text-neutral-500">{domain.description}</div>
            )}
          </button>
        ))}
      </nav>

      {showCreate && <CreateDomainDialog onClose={() => setShowCreate(false)} />}
    </aside>
  )
}
