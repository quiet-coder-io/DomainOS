import { Sidebar } from './components'
import { DomainListPage, DomainChatPage } from './pages'
import { useDomainStore } from './stores'

export function App(): React.JSX.Element {
  const activeDomainId = useDomainStore((s) => s.activeDomainId)

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100">
      <Sidebar />
      <main className="flex-1">{activeDomainId ? <DomainChatPage /> : <DomainListPage />}</main>
    </div>
  )
}
