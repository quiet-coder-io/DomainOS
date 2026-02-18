import { create } from 'zustand'
import type { KBUpdateProposal } from '../../preload/api'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  stopBlocks?: Array<{ reason: string; actionNeeded: string }>
  gapFlags?: Array<{ category: string; description: string }>
  decisions?: Array<{ decisionId: string; decision: string }>
}

interface ChatState {
  /** Messages for the currently active domain. */
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  kbProposals: KBUpdateProposal[]

  /** Per-domain message storage (in-memory, lost on app restart). */
  messagesByDomain: Record<string, ChatMessage[]>
  proposalsByDomain: Record<string, KBUpdateProposal[]>
  activeDomainId: string | null

  switchDomain(domainId: string, domainName: string): void
  sendMessage(content: string, domainId: string, apiKey: string): Promise<void>
  applyProposal(domainId: string, index: number): Promise<void>
  dismissProposal(index: number): void
  clearMessages(): void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  kbProposals: [],
  messagesByDomain: {},
  proposalsByDomain: {},
  activeDomainId: null,

  switchDomain(domainId, domainName) {
    const state = get()
    const updates: Partial<ChatState> = {}

    // Save current domain's state
    if (state.activeDomainId) {
      updates.messagesByDomain = {
        ...state.messagesByDomain,
        [state.activeDomainId]: state.messages,
      }
      updates.proposalsByDomain = {
        ...state.proposalsByDomain,
        [state.activeDomainId]: state.kbProposals,
      }
    }

    // Restore target domain's state (or start fresh with divider)
    const savedMessages = (updates.messagesByDomain ?? state.messagesByDomain)[domainId]
    const savedProposals = (updates.proposalsByDomain ?? state.proposalsByDomain)[domainId]

    set({
      ...updates,
      activeDomainId: domainId,
      messages: savedMessages ?? [{ role: 'system' as const, content: domainName }],
      kbProposals: savedProposals ?? [],
      streamingContent: '',
    })
  },

  async sendMessage(content, domainId, apiKey) {
    const userMessage: ChatMessage = { role: 'user', content }
    const currentMessages = [...get().messages, userMessage]

    set({
      messages: currentMessages,
      isStreaming: true,
      streamingContent: '',
    })

    // Listen for streaming chunks
    window.domainOS.chat.onStreamChunk((chunk) => {
      set((s) => ({ streamingContent: s.streamingContent + chunk }))
    })

    const result = await window.domainOS.chat.send({
      domainId,
      messages: currentMessages.filter((m) => m.role !== 'system') as Array<{ role: 'user' | 'assistant'; content: string }>,
      apiKey,
    })

    // Clean up listeners
    window.domainOS.chat.offStreamChunk()
    window.domainOS.chat.offStreamDone()

    if (result.ok && result.value) {
      const newMessages = [
        ...currentMessages,
        {
          role: 'assistant' as const,
          content: result.value.content,
          stopBlocks: result.value.stopBlocks,
          gapFlags: result.value.gapFlags,
          decisions: result.value.decisions,
        },
      ]
      const newProposals = [...get().kbProposals, ...result.value.proposals]
      set({
        messages: newMessages,
        isStreaming: false,
        streamingContent: '',
        kbProposals: newProposals,
        messagesByDomain: { ...get().messagesByDomain, [domainId]: newMessages },
        proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals },
      })
    } else {
      let errorContent = result.error ?? 'Unknown error occurred'
      // Try to extract human-readable message from API error JSON
      try {
        const parsed = JSON.parse(errorContent.replace(/^Error:\s*\d+\s*/, ''))
        if (parsed?.error?.message) errorContent = parsed.error.message
      } catch {
        // If error contains embedded JSON, try to extract message from it
        const msgMatch = errorContent.match(/"message"\s*:\s*"([^"]+)"/)
        if (msgMatch) errorContent = msgMatch[1]
      }
      const newMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: `Error: ${errorContent}` },
      ]
      set({
        messages: newMessages,
        isStreaming: false,
        streamingContent: '',
        messagesByDomain: { ...get().messagesByDomain, [domainId]: newMessages },
      })
    }
  },

  async applyProposal(domainId, index) {
    const proposal = get().kbProposals[index]
    if (!proposal) return

    await window.domainOS.kbUpdate.apply(domainId, proposal)

    const newProposals = get().kbProposals.filter((_, i) => i !== index)
    set({
      kbProposals: newProposals,
      proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals },
    })
  },

  dismissProposal(index) {
    const domainId = get().activeDomainId
    const newProposals = get().kbProposals.filter((_, i) => i !== index)
    set({
      kbProposals: newProposals,
      ...(domainId ? { proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals } } : {}),
    })
  },

  clearMessages() {
    const domainId = get().activeDomainId
    set({
      messages: [],
      streamingContent: '',
      kbProposals: [],
      ...(domainId ? {
        messagesByDomain: { ...get().messagesByDomain, [domainId]: [] },
        proposalsByDomain: { ...get().proposalsByDomain, [domainId]: [] },
      } : {}),
    })
  },
}))
