import { useEffect, useState } from 'react'
import { Sidebar, IntakePanel, OnboardingFlow } from './components'
import { DomainListPage, DomainChatPage } from './pages'
import { BriefingPage } from './pages/BriefingPage'
import { useDomainStore, useIntakeStore } from './stores'

export type ActiveView = 'domains' | 'intake' | 'briefing'

export function App(): React.JSX.Element {
  const activeDomainId = useDomainStore((s) => s.activeDomainId)
  const domains = useDomainStore((s) => s.domains)
  const domainsLoading = useDomainStore((s) => s.loading)
  const fetchPending = useIntakeStore((s) => s.fetchPending)
  const [activeView, setActiveView] = useState<ActiveView>('domains')

  // Listen for new intake items from the server
  useEffect(() => {
    window.domainOS.intake.onNewItem(() => {
      fetchPending()
    })
    return () => {
      window.domainOS.intake.offNewItem()
    }
  }, [fetchPending])

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
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</main>
    </div>
  )
}
