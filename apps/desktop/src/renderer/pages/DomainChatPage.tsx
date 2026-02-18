import { useEffect, useRef } from 'react'
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

      {/* Right sidebar — KB files + proposals + panels */}
      <div className="w-72 overflow-y-auto border-l border-border-subtle bg-surface-0 p-4">
        <SessionIndicator domainId={activeDomainId} />

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
  )
}
