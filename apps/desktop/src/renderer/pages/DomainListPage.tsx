import { useEffect } from 'react'
import { LayersIcon } from '../components/icons/LayersIcon'
import { useBriefingStore } from '../stores'
import type { DomainStatus } from '../../preload/api'
import type { ActiveView } from '../App'

const DOT_COLORS: Record<DomainStatus, string> = {
  active: 'bg-green-400',
  quiet: 'bg-gray-400',
  'stale-risk': 'bg-amber-400',
  blocked: 'bg-red-400',
}

interface Props {
  onViewChange: (view: ActiveView) => void
}

export function DomainListPage({ onViewChange }: Props): React.JSX.Element {
  const { health, fetchHealth } = useBriefingStore()

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative text-center">
        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 -m-24 rounded-full bg-accent/5 blur-3xl" />

        <div className="relative">
          <div className="mb-4 flex justify-center text-text-tertiary">
            <LayersIcon />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">DomainOS</h1>
          <p className="mt-3 text-sm text-text-tertiary">
            Select a domain from the sidebar or create a new one to get started.
          </p>

          {/* Health chip strip */}
          {health && health.domains.length > 0 && (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {health.domains.map((dh) => (
                  <span
                    key={dh.domainId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text-secondary"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLORS[dh.status]}`} />
                    {dh.domainName}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onViewChange('briefing')}
                className="mt-3 text-xs text-accent hover:underline"
              >
                View full briefing →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
