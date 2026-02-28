import { useEffect } from 'react'
import { LayersIcon } from '../components/icons/LayersIcon'
import { BrainIcon } from '../components/icons/BrainIcon'
import { useBriefingStore } from '../stores'
import type { DomainStatus } from '../../preload/api'
import type { ActiveView } from '../App'

const DOT_COLORS: Record<DomainStatus, string> = {
  active: 'bg-green-400',
  quiet: 'bg-gray-400',
  'stale-risk': 'bg-amber-400',
  blocked: 'bg-red-400',
}

const VIEW_PLUGINS = 'plugins' as const
const VIEW_MISSIONS = 'missions' as const

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
              <div id="domain-chip-strip" className="flex flex-wrap items-center justify-center gap-2">
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

              {/* Toolkit overview */}
              <div className="mx-auto mt-6 max-w-2xl">
                <p className="mb-3 text-xs text-text-tertiary">
                  Start with Skills, extend with Plugins, automate with Missions.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
                  {/* Skills card */}
                  <div className="flex h-full flex-col rounded-lg border border-border-subtle bg-surface-2 p-4 text-left">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-accent">
                        <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clipRule="evenodd" />
                      </svg>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Skills</h3>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">One-message procedures</p>
                    <ul className="mt-2 list-disc pl-4 space-y-1 leading-snug text-xs text-text-secondary">
                      <li>Write step-by-step instructions</li>
                      <li>Choose per message; clears after send</li>
                      <li>Create your own or customize plugin skills</li>
                    </ul>
                    <button
                      type="button"
                      className="mt-auto pt-3 text-left text-xs text-accent hover:underline focus:outline-none focus:underline"
                      onClick={() => {
                        const el = document.getElementById('domain-list') ?? document.getElementById('domain-chip-strip')
                        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                    >
                      Select a domain to use Skills →
                    </button>
                  </div>

                  {/* Plugins card */}
                  <div className="flex h-full flex-col rounded-lg border border-border-subtle bg-surface-2 p-4 text-left">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-accent">
                        <path d="M12 4.467c0-.405.262-.75.559-1.027.276-.257.441-.584.441-.94 0-.828-.895-1.5-2-1.5s-2 .672-2 1.5c0 .362.171.694.456.953.29.265.544.6.544.994V6H8a4 4 0 0 0-4 4v1h-.5A1.5 1.5 0 0 0 2 12.5v1A1.5 1.5 0 0 0 3.5 15H4v1a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-1h.5a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5H16v-1a4 4 0 0 0-4-4V4.467Z" />
                      </svg>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Plugins</h3>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">Installable toolkits</p>
                    <ul className="mt-2 list-disc pl-4 space-y-1 leading-snug text-xs text-text-secondary">
                      <li>Install toolkits (finance, legal…)</li>
                      <li>Bundles skills + commands</li>
                      <li>Enable per domain</li>
                    </ul>
                    <button
                      type="button"
                      className="mt-auto pt-3 text-left text-xs text-accent hover:underline focus:outline-none focus:underline"
                      onClick={() => onViewChange(VIEW_PLUGINS)}
                    >
                      Browse Plugins →
                    </button>
                  </div>

                  {/* Missions card */}
                  <div className="flex h-full flex-col rounded-lg border border-border-subtle bg-surface-2 p-4 text-left">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-accent">
                        <path fillRule="evenodd" d="M4.606 12.97a.75.75 0 0 1-.134 1.051 2.494 2.494 0 0 0-.93 2.437 2.494 2.494 0 0 0 2.437-.93.75.75 0 1 1 1.186.918 3.995 3.995 0 0 1-4.482 1.332.75.75 0 0 1-.461-.461 3.994 3.994 0 0 1 1.332-4.482.75.75 0 0 1 1.052.134Z" clipRule="evenodd" />
                        <path fillRule="evenodd" d="M13.703 4.469a3.25 3.25 0 0 0-4.122.585l-5.317 5.92a.75.75 0 0 0 1.116 1.004l5.318-5.92a1.75 1.75 0 0 1 2.22-.316l.152.094c.268.165.588.252.913.252h.94a.75.75 0 0 0 0-1.5h-.94a.424.424 0 0 1-.168-.046l-.112-.073Z" clipRule="evenodd" />
                      </svg>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-primary">Missions</h3>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">Multi-step runs</p>
                    <ul className="mt-2 list-disc pl-4 space-y-1 leading-snug text-xs text-text-secondary">
                      <li>Run multi-step analysis</li>
                      <li>Structured outputs (memos, alerts)</li>
                      <li>Approval gates before side effects</li>
                    </ul>
                    <button
                      type="button"
                      className="mt-auto pt-3 text-left text-xs text-accent hover:underline focus:outline-none focus:underline"
                      onClick={() => onViewChange(VIEW_MISSIONS)}
                    >
                      Open Mission Control →
                    </button>
                  </div>
                </div>
              </div>

              {/* Brainstorm feature tip */}
              <div className="mt-6 mx-auto max-w-sm rounded-lg border border-border-subtle bg-surface-2 p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <BrainIcon className="h-4 w-4 text-accent" />
                  Strategic Brainstorming
                </div>
                <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                  Run deep, technique-driven brainstorming with 100+ methods.
                  Your AI facilitates multi-round exploration and synthesizes
                  ideas into actionable strategic options.
                </p>
                <p className="mt-2 text-xs text-text-tertiary">
                  Select a domain, then type: <span className="font-medium text-text-secondary">Deep brainstorm</span>
                </p>
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
