import { useState } from 'react'
import { useDomainStore, useChatStore } from '../stores'
import { ChatPanel } from '../components/ChatPanel'
import { KBFileList } from '../components/KBFileList'
import { KBUpdateProposal } from '../components/KBUpdateProposal'

export function DomainChatPage(): React.JSX.Element {
  const { activeDomainId, domains } = useDomainStore()
  const { kbProposals, applyProposal, dismissProposal } = useChatStore()
  const [apiKey, setApiKey] = useState('')

  const domain = domains.find((d) => d.id === activeDomainId)
  if (!domain || !activeDomainId) return <div />

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* API Key bar */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
          <span className="text-xs text-neutral-500">API Key:</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-64 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
            placeholder="sk-ant-..."
          />
          <span className="text-xs text-neutral-600">(stored in memory only)</span>
          <div className="flex-1" />
          <span className="text-sm font-medium text-neutral-300">{domain.name}</span>
        </div>

        <ChatPanel domainId={activeDomainId} apiKey={apiKey} />
      </div>

      {/* Right sidebar — KB files + proposals */}
      <div className="w-72 overflow-y-auto border-l border-neutral-800 p-4">
        <KBFileList domainId={activeDomainId} />

        {kbProposals.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-neutral-300">KB Update Proposals</h3>
            {kbProposals.map((proposal, i) => (
              <KBUpdateProposal
                key={i}
                proposal={proposal}
                index={i}
                onAccept={(idx) => applyProposal(activeDomainId, idx)}
                onDismiss={dismissProposal}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
