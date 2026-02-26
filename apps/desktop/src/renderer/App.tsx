import { useEffect, useState } from 'react'
import { Sidebar, IntakePanel, OnboardingFlow, ToastContainer } from './components'
import { DomainListPage, DomainChatPage } from './pages'
import { BriefingPage } from './pages/BriefingPage'
import { MissionControlPage } from './pages/MissionControlPage'
import { useDomainStore, useIntakeStore, useToastStore } from './stores'
import { useTheme } from './hooks/useTheme'

// ── Window titlebar (macOS: custom drag region + pin control) ──

const TITLEBAR_H = 38
const TRAFFIC_LIGHT_SAFE_LEFT = 72
const isMac = window.domainOS.platform === 'darwin'

const PinIcon = ({ pinned }: { pinned: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M9.5 1.5L14.5 6.5L10 8L11.5 14.5L8 11L4.5 14.5L6 8L1.5 6.5L6.5 1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill={pinned ? 'currentColor' : 'none'}
    />
  </svg>
)

function WindowTitlebar(): React.JSX.Element {
  const [isPinned, setIsPinned] = useState(false)

  useEffect(() => {
    window.domainOS.appWindow.getPinned().then((res) => {
      if (res.ok && res.value != null) setIsPinned(res.value)
    })
    const unsub = window.domainOS.appWindow.onPinnedChanged?.((data) => {
      setIsPinned(data.pinned)
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  async function handleTogglePin(): Promise<void> {
    const next = !isPinned
    setIsPinned(next)
    const res = await window.domainOS.appWindow.setPinned(next)
    if (!res.ok) setIsPinned(!next)
  }

  return (
    <div
      className="titlebar-drag shrink-0 flex items-center border-b border-border-subtle bg-surface-0 select-none cursor-default"
      style={{ height: TITLEBAR_H, paddingLeft: isMac ? TRAFFIC_LIGHT_SAFE_LEFT : 12, paddingRight: 12 }}
    >
      <div className="flex-1" />
      <div className="titlebar-no-drag pointer-events-auto">
        <button
          onClick={handleTogglePin}
          className={`titlebar-no-drag pointer-events-auto cursor-pointer flex h-7 w-7 items-center justify-center rounded transition-colors ${
            isPinned
              ? 'text-accent hover:bg-accent/10'
              : 'text-text-tertiary hover:bg-surface-2 hover:text-text-secondary'
          }`}
          aria-label={isPinned ? 'Unpin window' : 'Pin window on top'}
          title={isPinned ? 'Unpin window' : 'Pin window on top'}
        >
          <PinIcon pinned={isPinned} />
        </button>
      </div>
    </div>
  )
}

export type ActiveView = 'domains' | 'intake' | 'briefing' | 'missions'

export function App(): React.JSX.Element {
  const activeDomainId = useDomainStore((s) => s.activeDomainId)
  const domains = useDomainStore((s) => s.domains)
  const domainsLoading = useDomainStore((s) => s.loading)
  const fetchPending = useIntakeStore((s) => s.fetchPending)
  const [activeView, setActiveView] = useState<ActiveView>('domains')
  const addToast = useToastStore((s) => s.addToast)
  const { theme, toggleTheme } = useTheme()

  // Listen for new intake items from the server
  useEffect(() => {
    window.domainOS.intake.onNewItem(() => {
      fetchPending()
    })
    return () => {
      window.domainOS.intake.offNewItem()
    }
  }, [fetchPending])

  // Listen for automation notifications
  useEffect(() => {
    window.domainOS.automation.onNotification((data) => {
      addToast({
        message: `[${data.automationName}] ${data.message}`,
        type: 'info',
        domainId: data.domainId,
        autoDismissMs: 8000,
      })
    })
    return () => {
      window.domainOS.automation.offNotification()
    }
  }, [addToast])

  const renderMainContent = () => {
    if (activeView === 'intake') return <IntakePanel />
    if (activeView === 'briefing') return <BriefingPage onViewChange={setActiveView} />
    if (activeView === 'missions') return <MissionControlPage onViewChange={setActiveView} />
    if (domainsLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-text-tertiary">Loading...</p>
        </div>
      )
    }
    if (domains.length === 0) return <OnboardingFlow />
    return activeDomainId
      ? <DomainChatPage />
      : <DomainListPage onViewChange={setActiveView} />
  }

  return (
    <div className="flex h-screen flex-col bg-surface-0 text-text-primary">
      <WindowTitlebar />
      <div className="flex flex-1 min-h-0">
        <Sidebar activeView={activeView} onViewChange={setActiveView} theme={theme} onToggleTheme={toggleTheme} />
        <main className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</main>
      </div>
      <ToastContainer />
    </div>
  )
}
