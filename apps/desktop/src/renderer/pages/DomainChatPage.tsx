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
import { SettingsDialog } from '../components/SettingsDialog'

const DocumentIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary">
    <path d="M5 2h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M11 2v4h4" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1" />
    <line x1="6" y1="11.5" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1" />
    <line x1="6" y1="14" x2="9" y2="14" stroke="currentColor" strokeWidth="1" />
  </svg>
)

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.86 1.33h2.28l.34 1.7a5.47 5.47 0 0 1 1.32.76l1.64-.6.84 1.46-1.3 1.1c.07.27.1.54.1.82s-.03.55-.1.82l1.3 1.1-.84 1.46-1.64-.6c-.4.32-.84.58-1.32.76l-.34 1.7H6.86l-.34-1.7a5.47 5.47 0 0 1-1.32-.76l-1.64.6-.84-1.46 1.3-1.1A4.2 4.2 0 0 1 3.92 6.57l-1.3-1.1.84-1.46 1.64.6a5.47 5.47 0 0 1 1.32-.76l.34-1.7ZM8 10a2.33 2.33 0 1 0 0-4.67A2.33 2.33 0 0 0 8 10Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
)

type ProviderName = 'anthropic' | 'openai' | 'ollama'

const KNOWN_MODELS: Record<ProviderName, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'mixtral'],
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.2',
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
}

export function DomainChatPage(): React.JSX.Element {
  const { activeDomainId, domains, updateDomain } = useDomainStore()
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
  const { providerConfig, loadProviderConfig, ollamaModels, listOllamaModels } = useSettingsStore()

  const [showSettings, setShowSettings] = useState(false)

  // --- Per-domain model override state ---
  const [overrideExpanded, setOverrideExpanded] = useState(false)
  const [overrideProvider, setOverrideProvider] = useState<ProviderName | ''>('')
  const [overrideModel, setOverrideModel] = useState('')
  const [overrideCustom, setOverrideCustom] = useState('')
  const [useCustomOverride, setUseCustomOverride] = useState(false)

  // --- Resizable sidebar state ---
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem('domainOS:sidebarWidth')
    const n = raw ? Number(raw) : NaN
    if (!Number.isFinite(n)) return 288
    return Math.round(Math.max(200, Math.min(n, window.innerWidth - 580)))
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
      const w = Math.round(Math.max(200, Math.min(window.innerWidth - e.clientX, window.innerWidth - 580)))
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
        const clamped = Math.round(Math.max(200, Math.min(prev, window.innerWidth - 580)))
        if (clamped !== prev) localStorage.setItem('domainOS:sidebarWidth', String(clamped))
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // --- Gmail connection state ---
  const [gmailStatus, setGmailStatus] = useState<{
    connected: boolean
    blocked?: boolean
    email?: string
  }>({ connected: false })
  const [gmailLoading, setGmailLoading] = useState(false)

  const refreshGmailStatus = useCallback(async () => {
    const res = await window.domainOS.gmail.checkConnected()
    if (res.ok && res.value) setGmailStatus(res.value)
  }, [])

  useEffect(() => {
    refreshGmailStatus()
  }, [refreshGmailStatus])

  async function handleGmailConnect(): Promise<void> {
    setGmailLoading(true)
    try {
      await window.domainOS.gmail.startOAuth()
      await refreshGmailStatus()
    } catch {
      await refreshGmailStatus()
    } finally {
      setGmailLoading(false)
    }
  }

  async function handleGmailDisconnect(): Promise<void> {
    setGmailLoading(true)
    try {
      await window.domainOS.gmail.disconnect()
      await refreshGmailStatus()
    } finally {
      setGmailLoading(false)
    }
  }

  async function handleToggleAllowGmail(): Promise<void> {
    if (!activeDomainId || !domain) return
    const newValue = !domain.allowGmail
    await window.domainOS.domain.update(activeDomainId, { allowGmail: newValue })
    await useDomainStore.getState().fetchDomains()
  }

  // Load provider config on mount
  useEffect(() => {
    loadProviderConfig()
  }, [loadProviderConfig])

  // Switch domain context
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

  // Auto-load Ollama models when Ollama is selected as override provider
  useEffect(() => {
    if (overrideProvider === 'ollama' && ollamaModels.length === 0) {
      const url = providerConfig?.ollamaBaseUrl || 'http://localhost:11434'
      listOllamaModels(url)
    }
  }, [overrideProvider, ollamaModels.length, providerConfig?.ollamaBaseUrl, listOllamaModels])

  // Sync override dropdown values from domain (never controls expanded state)
  useEffect(() => {
    if (!domain) return
    if (domain.modelProvider) {
      setOverrideProvider(domain.modelProvider as ProviderName)
      const known = KNOWN_MODELS[domain.modelProvider as ProviderName] ?? []
      const allKnown = domain.modelProvider === 'ollama'
        ? [...new Set([...ollamaModels, ...known])]
        : known
      if (domain.modelName && allKnown.includes(domain.modelName)) {
        setOverrideModel(domain.modelName)
        setUseCustomOverride(false)
        setOverrideCustom('')
      } else if (domain.modelName) {
        setOverrideModel('__custom__')
        setUseCustomOverride(true)
        setOverrideCustom(domain.modelName)
      }
    } else {
      setOverrideProvider('')
      setOverrideModel('')
      setOverrideCustom('')
      setUseCustomOverride(false)
    }
  }, [domain?.id, domain?.modelProvider, domain?.modelName, ollamaModels])

  if (!domain || !activeDomainId) return <div />

  // Resolve effective provider/model for display
  const effectiveProvider = (domain.modelProvider ?? providerConfig?.defaultProvider ?? 'anthropic') as ProviderName
  const effectiveModel = domain.modelName ?? providerConfig?.defaultModel ?? DEFAULT_MODELS[effectiveProvider]

  // --- Per-domain override handlers ---

  async function handleToggleOverride(): Promise<void> {
    if (!activeDomainId) return
    if (overrideExpanded) {
      // Clear override → set both to null
      await updateDomain(activeDomainId, { modelProvider: null, modelName: null })
      setOverrideExpanded(false)
      setOverrideProvider('')
      setOverrideModel('')
      setOverrideCustom('')
      setUseCustomOverride(false)
    } else {
      setOverrideExpanded(true)
      setOverrideProvider(effectiveProvider)
      setOverrideModel(effectiveModel)
    }
  }

  async function handleSaveOverride(): Promise<void> {
    if (!activeDomainId || !overrideProvider) return
    const model = useCustomOverride ? overrideCustom.trim() : overrideModel
    if (!model || model === '__custom__') return
    await updateDomain(activeDomainId, {
      modelProvider: overrideProvider,
      modelName: model,
    })
    setOverrideExpanded(false)
  }

  function handleOverrideProviderChange(p: string): void {
    const pn = p as ProviderName
    setOverrideProvider(pn)
    setOverrideModel(DEFAULT_MODELS[pn])
    setUseCustomOverride(false)
    setOverrideCustom('')
  }

  function handleOverrideModelChange(val: string): void {
    if (val === '__custom__') {
      setOverrideModel('__custom__')
      setUseCustomOverride(true)
    } else {
      setOverrideModel(val)
      setUseCustomOverride(false)
      setOverrideCustom('')
    }
  }

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header bar */}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
          {/* Settings gear */}
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
            title="Settings"
          >
            <GearIcon />
          </button>

          {/* Effective model display */}
          <span className="text-xs text-text-tertiary">
            {PROVIDER_LABELS[effectiveProvider]} / {effectiveModel}
          </span>
          {domain.modelProvider && (
            <span className="text-[10px] text-accent" title="This domain uses a model override">
              override
            </span>
          )}

          {/* Gmail connection + per-domain toggle */}
          <div className="ml-3 flex items-center gap-2 border-l border-border-subtle pl-3">
            {gmailStatus.blocked ? (
              <span className="text-xs text-text-tertiary">Gmail unavailable</span>
            ) : gmailStatus.connected ? (
              <>
                <span className="text-xs text-success">Gmail: {gmailStatus.email || 'connected'}</span>
                <button
                  onClick={handleGmailDisconnect}
                  disabled={gmailLoading}
                  className="text-xs text-text-tertiary hover:text-danger disabled:opacity-50"
                >
                  Disconnect
                </button>
                <label className="flex items-center gap-1 text-xs text-text-tertiary cursor-pointer" title="When enabled, this domain's agent can search and read your Gmail during conversations.">
                  <input
                    type="checkbox"
                    checked={domain.allowGmail}
                    onChange={handleToggleAllowGmail}
                    className="h-3 w-3 rounded border-border accent-accent"
                  />
                  Gmail tools
                </label>
              </>
            ) : (
              <button
                onClick={handleGmailConnect}
                disabled={gmailLoading}
                className="text-xs text-accent hover:text-accent-hover disabled:opacity-50"
              >
                {gmailLoading ? 'Connecting...' : 'Connect Gmail'}
              </button>
            )}
          </div>

          <div className="flex-1" />

          {/* Domain name + model override toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-secondary">{domain.name}</span>
            <button
              onClick={handleToggleOverride}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                overrideExpanded
                  ? 'border-accent text-accent'
                  : 'border-border text-text-tertiary hover:text-text-secondary'
              }`}
              title={overrideExpanded ? 'Clear model override (use global default)' : 'Set model override for this domain'}
            >
              {overrideExpanded ? 'Clear Override' : 'Model Override'}
            </button>
          </div>
        </div>

        {/* Per-domain model override panel (collapsible) */}
        {overrideExpanded && (
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-0 px-4 py-2">
            <span className="text-xs text-text-tertiary">Override:</span>
            <select
              value={overrideProvider}
              onChange={(e) => handleOverrideProviderChange(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
            </select>
            <select
              value={useCustomOverride ? '__custom__' : overrideModel}
              onChange={(e) => handleOverrideModelChange(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
            >
              {(overrideProvider === 'ollama'
                ? ollamaModels.length > 0
                  ? ollamaModels  // Show only installed models when available
                  : KNOWN_MODELS.ollama
                : KNOWN_MODELS[overrideProvider as ProviderName] ?? []
              ).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="__custom__">Custom...</option>
            </select>
            {useCustomOverride && (
              <input
                type="text"
                value={overrideCustom}
                onChange={(e) => setOverrideCustom(e.target.value)}
                className="w-40 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary"
                placeholder="model-id"
                maxLength={128}
              />
            )}
            <button
              onClick={handleSaveOverride}
              disabled={!overrideProvider || (!useCustomOverride && !overrideModel) || (useCustomOverride && !overrideCustom.trim())}
              className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Save
            </button>
            <label className="flex items-center gap-1 text-xs text-text-tertiary cursor-pointer ml-2" title="Force tool use attempt even when model capability is uncertain">
              <input
                type="checkbox"
                checked={domain.forceToolAttempt}
                onChange={async () => {
                  await updateDomain(activeDomainId, { forceToolAttempt: !domain.forceToolAttempt })
                }}
                className="h-3 w-3 rounded border-border accent-accent"
              />
              Force tools
            </label>
          </div>
        )}

        <ChatPanel domainId={activeDomainId} />
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

      {/* Settings modal */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
