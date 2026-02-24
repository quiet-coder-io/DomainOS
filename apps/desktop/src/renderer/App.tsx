import { useEffect, useState } from 'react'
import { Sidebar, IntakePanel, OnboardingFlow, ToastContainer } from './components'
import { DomainListPage, DomainChatPage } from './pages'
import { BriefingPage } from './pages/BriefingPage'
import { useDomainStore, useIntakeStore, useToastStore } from './stores'
import { useTheme } from './hooks/useTheme'

export type ActiveView = 'domains' | 'intake' | 'briefing'

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
    <div className="flex h-screen bg-surface-0 text-text-primary">
      <Sidebar activeView={activeView} onViewChange={setActiveView} theme={theme} onToggleTheme={toggleTheme} />
      <main className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</main>
      <ToastContainer />
    </div>
  )
}
