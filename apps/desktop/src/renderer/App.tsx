import { useEffect, useState } from 'react'
import { Sidebar, IntakePanel } from './components'
import { DomainListPage, DomainChatPage } from './pages'
import { useDomainStore, useIntakeStore } from './stores'

type ActiveView = 'domains' | 'intake'

export function App(): React.JSX.Element {
  const activeDomainId = useDomainStore((s) => s.activeDomainId)
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
    if (activeView === 'intake') {
      return <IntakePanel />
    }
    return activeDomainId ? <DomainChatPage /> : <DomainListPage />
  }

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 min-h-0 overflow-hidden">{renderMainContent()}</main>
    </div>
  )
}
