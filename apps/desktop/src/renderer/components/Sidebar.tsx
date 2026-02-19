import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useDomainStore, useIntakeStore } from '../stores'
import { CreateDomainDialog } from './CreateDomainDialog'
import { EditDomainDialog } from './EditDomainDialog'
import { DomainContextMenu } from './DomainContextMenu'
import { IntakeTokenDisplay } from './IntakeTokenDisplay'

interface SidebarProps {
  activeView: 'domains' | 'intake' | 'briefing'
  onViewChange: (view: 'domains' | 'intake' | 'briefing') => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const { domains, activeDomainId, loading, fetchDomains, setActiveDomain, deleteDomain } = useDomainStore()
  const { items: intakeItems, fetchPending } = useIntakeStore()
  const [showCreate, setShowCreate] = useState(false)
  const [createMode, setCreateMode] = useState<'add' | 'create'>('add')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const [contextMenu, setContextMenu] = useState<{ domainId: string; x: number; y: number } | null>(null)
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null)

  // Collapse state — persisted in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    const raw = localStorage.getItem('domainOS:sidebarCollapsed')
    return raw === '1'
  })

  useEffect(() => {
    localStorage.setItem('domainOS:sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), [])

  // Scroll position preservation across collapse/expand
  const navRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)

  useEffect(() => {
    if (!collapsed && navRef.current) {
      requestAnimationFrame(() => {
        if (navRef.current) navRef.current.scrollTop = scrollTopRef.current
      })
    }
  }, [collapsed])

  const handleCollapse = useCallback(() => {
    scrollTopRef.current = navRef.current?.scrollTop ?? 0
    setCollapsed(true)
  }, [])

  // Close "+ New" dropdown on click-outside or Escape
  useEffect(() => {
    if (!showNewMenu) return
    function handleMouseDown(e: MouseEvent): void {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node) &&
          newButtonRef.current && !newButtonRef.current.contains(e.target as Node)) {
        setShowNewMenu(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setShowNewMenu(false)
        newButtonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showNewMenu])

  useEffect(() => {
    fetchDomains()
    fetchPending()
  }, [fetchDomains, fetchPending])

  const intakeBadgeText = intakeItems.length > 99 ? '99+' : `${intakeItems.length}`

  return (
    <aside
      className={`flex h-full flex-col min-h-0 border-r border-border bg-surface-0 flex-shrink-0 transition-all duration-200 ease-in-out overflow-hidden ${
        collapsed ? 'w-12' : 'w-64'
      }`}
    >
      {collapsed ? (
        /* --- Collapsed rail view --- */
        <div className="flex flex-col items-center h-full">
          {/* Expand button */}
          <button
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            className="flex h-10 w-10 items-center justify-center text-text-tertiary hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent rounded mt-1"
          >
            <span className="text-sm font-bold">&raquo;</span>
          </button>

          {/* Intake icon button */}
          <button
            onClick={() => {
              onViewChange('intake')
              setCollapsed(false)
            }}
            aria-label="Open Intake"
            title="Intake"
            className="relative flex h-10 w-10 items-center justify-center text-text-tertiary hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M1 11.27c0-.246.033-.492.099-.73l1.523-5.521A2.75 2.75 0 0 1 5.273 3h9.454a2.75 2.75 0 0 1 2.651 2.019l1.523 5.52c.066.239.099.485.099.732V15.25A2.75 2.75 0 0 1 16.25 18H3.75A2.75 2.75 0 0 1 1 15.25V11.27ZM3.75 16.5a1.25 1.25 0 0 1-1.25-1.25v-3h3.214a.75.75 0 0 1 .672.416l.5 1a.75.75 0 0 0 .672.416h3.884a.75.75 0 0 0 .672-.416l.5-1a.75.75 0 0 1 .672-.416H17.5v3A1.25 1.25 0 0 1 16.25 16.5H3.75Z"
                clipRule="evenodd"
              />
            </svg>
            {intakeItems.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                {intakeBadgeText}
              </span>
            )}
          </button>

          {/* Briefing icon button */}
          <button
            onClick={() => {
              onViewChange('briefing')
              setCollapsed(false)
            }}
            aria-label="Open Briefing"
            title="Portfolio Briefing"
            className="flex h-10 w-10 items-center justify-center text-text-tertiary hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h16.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75ZM1 8.75A.75.75 0 0 1 1.75 8h16.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 8.75ZM1 14.75a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Divider */}
          <div className="mx-2 my-1 w-6 border-b border-border" />

          {/* Domain initial badges */}
          <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto py-1">
            {domains.map((domain) => {
              const isActive = activeDomainId === domain.id
              return (
                <button
                  key={domain.id}
                  onClick={() => {
                    setActiveDomain(domain.id)
                    setCollapsed(false)
                  }}
                  aria-label={`Open ${domain.name}`}
                  title={domain.name}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-accent ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'bg-surface-2 text-text-tertiary hover:bg-surface-3'
                  }`}
                >
                  {domain.name.charAt(0).toUpperCase()}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        /* --- Expanded view --- */
        <>
          {/* View tabs + collapse button */}
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
              onClick={() => onViewChange('briefing')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${
                activeView === 'briefing'
                  ? 'border-b-2 border-accent text-accent-text'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              Briefing
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
            <button
              onClick={handleCollapse}
              aria-label="Collapse sidebar"
              className="flex items-center justify-center px-2 text-text-tertiary hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              <span className="text-xs font-bold">&laquo;</span>
            </button>
          </div>

          {/* Domain list header */}
          {activeView === 'domains' && (
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-text-secondary">Domains</h2>
              <div className="relative">
                <button
                  ref={newButtonRef}
                  onClick={() => setShowNewMenu((prev) => !prev)}
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3"
                >
                  + New
                </button>
                {showNewMenu && (
                  <div
                    ref={newMenuRef}
                    className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded border border-border bg-surface-1 py-1 shadow-lg"
                  >
                    <button
                      autoFocus
                      onClick={() => {
                        setCreateMode('add')
                        setShowNewMenu(false)
                        setShowCreate(true)
                      }}
                      className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-2"
                    >
                      Add existing KB
                    </button>
                    <button
                      onClick={() => {
                        setCreateMode('create')
                        setShowNewMenu(false)
                        setShowCreate(true)
                      }}
                      className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-2"
                    >
                      Create new domain
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <nav ref={navRef} className="flex-1 min-h-0 overflow-y-auto p-2">
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
        </>
      )}

      {showCreate && <CreateDomainDialog mode={createMode} onClose={() => setShowCreate(false)} />}

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
