import { useEffect, useRef, useState, useCallback } from 'react'
import { useDomainStore, useChatStore, useSettingsStore } from '../stores'
import { ChatPanel } from '../components/ChatPanel'
import { KBFileList } from '../components/KBFileList'
import { KBUpdateProposal } from '../components/KBUpdateProposal'
import { RejectedProposal } from '../components/RejectedProposal'
import { ProtocolEditor } from '../components/ProtocolEditor'
import { SessionIndicator } from '../components/SessionIndicator'
import { GapFlagPanel } from '../components/GapFlagPanel'
import { DecisionLogPanel } from '../components/DecisionLogPanel'
import { AuditLogPanel } from '../components/AuditLogPanel'

const DocumentIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary">
    <path d="M5 2h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M11 2v4h4" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1" />
    <line x1="6" y1="11.5" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1" />
    <line x1="6" y1="14" x2="9" y2="14" stroke="currentColor" strokeWidth="1" />
  </svg>
)

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block">
    <rect x="1.5" y="4.5" width="7" height="5" rx="1" fill="currentColor" />
    <path d="M3 4.5V3a2 2 0 1 1 4 0v1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
)

export function DomainChatPage(): React.JSX.Element {
  const { activeDomainId, domains } = useDomainStore()
  const {
    messages,
    kbProposals,
    rejectedProposals,
    applyProposal,
    dismissProposal,
    editProposal,
    dismissRejectedProposal,
    switchDomain,
  } = useChatStore()
  const prevDomainIdRef = useRef<string | null>(null)
  const { apiKey, loading: apiKeyLoading, setApiKey, loadApiKey } = useSettingsStore()

  // --- Resizable sidebar state ---
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem('domainOS:sidebarWidth')
    const n = raw ? Number(raw) : NaN
    if (!Number.isFinite(n)) return 288
    return Math.round(Math.max(200, Math.min(n, window.innerWidth * 0.5)))
  })
  const isDragging = useRef(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => { sidebarWidthRef.current = sidebarWidth }, [sidebarWidth])

  // --- Collapsible right sidebar state ---
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    return localStorage.getItem('domainOS:rightSidebarCollapsed') === '1'
  })
  useEffect(() => {
    localStorage.setItem('domainOS:rightSidebarCollapsed', rightCollapsed ? '1' : '0')
  }, [rightCollapsed])

  const rightPanelRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef(0)
  const rightCollapsedRef = useRef(rightCollapsed)
  useEffect(() => { rightCollapsedRef.current = rightCollapsed }, [rightCollapsed])

  const collapseRight = useCallback(() => {
    if (rightPanelRef.current) rightScrollRef.current = rightPanelRef.current.scrollTop
    isDragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setRightCollapsed(true)
  }, [])

  const expandRight = useCallback(() => setRightCollapsed(false), [])

  // Restore scroll on expand
  useEffect(() => {
    if (!rightCollapsed && rightPanelRef.current) {
      requestAnimationFrame(() => {
        if (rightPanelRef.current) rightPanelRef.current.scrollTop = rightScrollRef.current
      })
    }
  }, [rightCollapsed])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!isDragging.current) return
      const w = Math.round(Math.max(200, Math.min(window.innerWidth - e.clientX, window.innerWidth * 0.5)))
      setSidebarWidth(w)
    }
    const up = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('domainOS:sidebarWidth', String(sidebarWidthRef.current))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      isDragging.current = false
    }
  }, [])

  // Re-clamp on window resize (skip when collapsed)
  useEffect(() => {
    const onResize = () => {
      if (rightCollapsedRef.current) return
      setSidebarWidth(prev => {
        const clamped = Math.round(Math.max(200, Math.min(prev, window.innerWidth * 0.5)))
        if (clamped !== prev) localStorage.setItem('domainOS:sidebarWidth', String(clamped))
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    loadApiKey()
  }, [loadApiKey])

  // Switch domain context: save current messages, restore target domain's messages
  useEffect(() => {
    if (!activeDomainId) return
    const prev = prevDomainIdRef.current
    prevDomainIdRef.current = activeDomainId
    if (prev !== activeDomainId) {
      const name = domains.find((d) => d.id === activeDomainId)?.name ?? 'Unknown'
      switchDomain(activeDomainId, name)
    }
  }, [activeDomainId, domains, switchDomain])

  const domain = domains.find((d) => d.id === activeDomainId)
  if (!domain || !activeDomainId) return <div />

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* API Key bar */}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
          <span className="text-xs text-text-tertiary">API Key:</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-64 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            placeholder="sk-ant-..."
          />
          <span className="flex items-center gap-1 text-xs text-text-tertiary">
            <LockIcon /> encrypted
          </span>
          <div className="flex-1" />
          <span className="text-sm font-medium text-text-secondary">{domain.name}</span>
        </div>

        <ChatPanel domainId={activeDomainId} apiKey={apiKey} />
      </div>

      {/* Resize divider — hidden when collapsed */}
      {!rightCollapsed && (
        <div className="relative flex-shrink-0 h-full focus:outline-none" role="separator" aria-orientation="vertical" tabIndex={0}>
          <div
            onPointerDown={(e) => { e.preventDefault(); handlePointerDown(e) }}
            className="absolute inset-y-0 -left-1 w-3 cursor-col-resize z-10"
          />
          <div className="h-full w-px bg-border-subtle" />
        </div>
      )}

      {/* Right sidebar — collapsible KB panel */}
      <div
        className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
          rightCollapsed ? 'w-10' : ''
        }`}
        style={rightCollapsed ? undefined : { width: sidebarWidth }}
      >
        {rightCollapsed ? (
          /* Collapsed rail */
          <div className="flex h-full w-10 flex-col items-center border-l border-border-subtle bg-surface-0">
            <button
              onClick={expandRight}
              aria-label="Expand panel"
              className="flex h-10 w-10 items-center justify-center text-text-tertiary hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              onClick={expandRight}
              aria-label="Open KB panel"
              title="Knowledge Base"
              className="relative flex w-10 flex-1 items-center justify-center text-text-tertiary hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <DocumentIcon />
              {kbProposals.length > 0 && (
                <span className="absolute top-2 right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
                  {kbProposals.length > 99 ? '99+' : kbProposals.length}
                </span>
              )}
            </button>
          </div>
        ) : (
          /* Expanded panel */
          <div className="flex h-full flex-col border-l border-border-subtle bg-surface-0">
            {/* Header — fixed */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2">
              <button
                onClick={collapseRight}
                aria-label="Collapse panel"
                className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-surface-2 hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <SessionIndicator domainId={activeDomainId} />
            </div>

            {/* Scrollable body */}
            <div ref={rightPanelRef} className="flex-1 min-h-0 overflow-y-auto p-4">
              <KBFileList domainId={activeDomainId} />

              <ProtocolEditor domainId={activeDomainId} />

              {kbProposals.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-text-secondary">KB Update Proposals</h3>
                  {kbProposals.map((proposal) => (
                    <KBUpdateProposal
                      key={proposal.localId}
                      proposal={proposal}
                      onAccept={(id) => applyProposal(activeDomainId, id)}
                      onDismiss={dismissProposal}
                      onEdit={editProposal}
                    />
                  ))}
                </div>
              )}

              {rejectedProposals.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-warning">Rejected Proposals</h3>
                  {rejectedProposals.map((proposal) => (
                    <RejectedProposal
                      key={proposal.id}
                      proposal={proposal}
                      onDismiss={dismissRejectedProposal}
                    />
                  ))}
                </div>
              )}

              <GapFlagPanel domainId={activeDomainId} />
              <DecisionLogPanel domainId={activeDomainId} />
              <AuditLogPanel domainId={activeDomainId} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
