import { useEffect, useState } from 'react'
import { useDomainStore, useIntakeStore } from '../stores'
import { CreateDomainDialog } from './CreateDomainDialog'
import { EditDomainDialog } from './EditDomainDialog'
import { DomainContextMenu } from './DomainContextMenu'
import { IntakeTokenDisplay } from './IntakeTokenDisplay'

interface SidebarProps {
  activeView: 'domains' | 'intake'
  onViewChange: (view: 'domains' | 'intake') => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const { domains, activeDomainId, loading, fetchDomains, setActiveDomain, deleteDomain } = useDomainStore()
  const { items: intakeItems, fetchPending } = useIntakeStore()
  const [showCreate, setShowCreate] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ domainId: string; x: number; y: number } | null>(null)
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null)

  useEffect(() => {
    fetchDomains()
    fetchPending()
  }, [fetchDomains, fetchPending])

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface-0">
      {/* View tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => onViewChange('domains')}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            activeView === 'domains'
              ? 'border-b-2 border-accent text-accent-text'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Domains
        </button>
        <button
          onClick={() => onViewChange('intake')}
          className={`flex items-center justify-center gap-1.5 flex-1 px-3 py-2 text-xs font-medium ${
            activeView === 'intake'
              ? 'border-b-2 border-accent text-accent-text'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          Intake
          {intakeItems.length > 0 && (
            <span className="rounded-full bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent-text">
              {intakeItems.length}
            </span>
          )}
        </button>
      </div>

      {/* Domain list header */}
      {activeView === 'domains' && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-secondary">Domains</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
          >
            + New
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        {activeView === 'domains' && (
          <>
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
                  onClick={() => {
                    setActiveDomain(domain.id)
                    onViewChange('domains')
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ domainId: domain.id, x: e.clientX, y: e.clientY })
                  }}
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
          </>
        )}

        {activeView === 'intake' && (
          <div className="px-2 py-4 text-center">
            <p className="text-xs text-text-tertiary">
              {intakeItems.length} pending item{intakeItems.length !== 1 ? 's' : ''}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Select Intake tab to review.
            </p>
          </div>
        )}
      </nav>

      <IntakeTokenDisplay />

      {showCreate && <CreateDomainDialog onClose={() => setShowCreate(false)} />}

      {contextMenu && (
        <DomainContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={() => setEditingDomainId(contextMenu.domainId)}
          onDelete={() => {
            if (window.confirm('Delete this domain? This cannot be undone.')) {
              deleteDomain(contextMenu.domainId)
            }
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editingDomainId && (() => {
        const domain = domains.find((d) => d.id === editingDomainId)
        if (!domain) return null
        return (
          <EditDomainDialog
            domain={domain}
            onClose={() => setEditingDomainId(null)}
          />
        )
      })()}
    </aside>
  )
}
