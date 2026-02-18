import { useEffect } from 'react'
import { useSessionStore } from '../stores'

interface Props {
  domainId: string
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

export function SessionIndicator({ domainId }: Props): React.JSX.Element | null {
  const { activeSession, fetchActive } = useSessionStore()

  useEffect(() => {
    fetchActive(domainId)
    const interval = setInterval(() => fetchActive(domainId), 30_000)
    return () => clearInterval(interval)
  }, [domainId, fetchActive])

  if (!activeSession) return null

  return (
    <div className="mb-3 flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs animate-fade-in">
      <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" />
      <span className="truncate text-text-secondary">{activeSession.scope}</span>
      <span className="text-text-tertiary">{elapsed(activeSession.startedAt)}</span>
      <span className="ml-auto text-text-tertiary">{activeSession.modelName}</span>
    </div>
  )
}
