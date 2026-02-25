import { create } from 'zustand'
import type { KBUpdateProposal, RejectedProposal, ToolUseEvent } from '../../preload/api'
import { fnv1aHash } from '../common/hash'

// --- Store-layer wrappers with IDs and source attribution ---

interface StoredProposal extends KBUpdateProposal {
  localId: string
  source: 'chat-send' | 'extract'
  sourceMessageIndex?: number
  isEdited?: boolean
}

interface StoredRejectedProposal extends RejectedProposal {
  source: 'chat-send' | 'extract'
  sourceMessageIndex?: number
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  status?: 'cancelled'
  stopBlocks?: Array<{ reason: string; actionNeeded: string }>
  gapFlags?: Array<{ category: string; description: string }>
  decisions?: Array<{ decisionId: string; decision: string }>
}

interface ExtractionResult {
  proposalCount: number
  messageLabel: string
}

interface ChatState {
  /** Messages for the currently active domain. */
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  kbProposals: StoredProposal[]
  rejectedProposals: StoredRejectedProposal[]

  /** Per-domain message storage (in-memory, lost on app restart). */
  messagesByDomain: Record<string, ChatMessage[]>
  proposalsByDomain: Record<string, StoredProposal[]>
  rejectedProposalsByDomain: Record<string, StoredRejectedProposal[]>
  activeDomainId: string | null

  /** Tool-use state (Gmail tool loop feedback) */
  activeToolCall: ToolUseEvent | null
  toolEvents: ToolUseEvent[]

  /** Extraction state */
  isExtracting: boolean
  lastExtractAt: Record<string, number>
  extractionError: string | null
  extractionResult: ExtractionResult | null

  /** Send guard to prevent double-sends */
  isSending: boolean

  switchDomain(domainId: string, domainName: string): void
  sendMessage(content: string, domainId: string): Promise<void>
  cancelChat(): void
  applyProposal(domainId: string, id: string): Promise<void>
  dismissProposal(id: string): void
  editProposal(id: string, newContent: string): void
  dismissRejectedProposal(id: string): void
  clearMessages(): void
  extractKbUpdates(domainId: string, content: string, messageIndex?: number): Promise<void>
  clearExtractionError(): void
  clearExtractionResult(): void
}

function buildProposalId(p: KBUpdateProposal): string {
  return fnv1aHash(`${p.file}|${p.action}|${p.tier}|${p.mode}|${p.reasoning}|${p.content.slice(0, 100)}`)
}

function toStoredProposal(
  p: KBUpdateProposal,
  source: 'chat-send' | 'extract',
  messageIndex?: number,
): StoredProposal {
  return {
    ...p,
    localId: buildProposalId(p),
    source,
    sourceMessageIndex: messageIndex,
  }
}

function toStoredRejected(
  r: RejectedProposal,
  source: 'chat-send' | 'extract',
  messageIndex?: number,
): StoredRejectedProposal {
  return {
    ...r,
    source,
    sourceMessageIndex: messageIndex,
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingContent: '',
  kbProposals: [],
  rejectedProposals: [],
  messagesByDomain: {},
  proposalsByDomain: {},
  rejectedProposalsByDomain: {},
  activeDomainId: null,
  activeToolCall: null,
  toolEvents: [],
  isSending: false,
  isExtracting: false,
  lastExtractAt: {},
  extractionError: null,
  extractionResult: null,

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
      updates.rejectedProposalsByDomain = {
        ...state.rejectedProposalsByDomain,
        [state.activeDomainId]: state.rejectedProposals,
      }
    }

    // Restore target domain's state (or start fresh with divider)
    const savedMessages = (updates.messagesByDomain ?? state.messagesByDomain)[domainId]
    const savedProposals = (updates.proposalsByDomain ?? state.proposalsByDomain)[domainId]
    const savedRejected = (updates.rejectedProposalsByDomain ?? state.rejectedProposalsByDomain)[domainId]

    set({
      ...updates,
      activeDomainId: domainId,
      messages: savedMessages ?? [{ role: 'system' as const, content: domainName }],
      kbProposals: savedProposals ?? [],
      rejectedProposals: savedRejected ?? [],
      streamingContent: '',
      extractionError: null,
      extractionResult: null,
    })
  },

  cancelChat() {
    window.domainOS.chat.sendCancel()
  },

  async sendMessage(content, domainId) {
    // Send guard: prevent double-sends
    if (get().isSending) return

    const userMessage: ChatMessage = { role: 'user', content }
    const currentMessages = [...get().messages, userMessage]

    set({
      messages: currentMessages,
      isStreaming: true,
      isSending: true,
      streamingContent: '',
      activeToolCall: null,
      toolEvents: [],
    })

    // Listen for streaming chunks
    window.domainOS.chat.onStreamChunk((chunk) => {
      set((s) => ({ streamingContent: s.streamingContent + chunk }))
    })

    // Listen for tool-use events (Gmail tool loop)
    const unsubToolUse = window.domainOS.chat.onToolUse((data) => {
      const event = data as ToolUseEvent
      set((s) => ({
        activeToolCall: event.status === 'running'
          ? event
          : (s.activeToolCall?.toolUseId === event.toolUseId ? null : s.activeToolCall),
        toolEvents: [...s.toolEvents, event].slice(-100),
      }))
    })

    try {
      const result = await window.domainOS.chat.send({
        domainId,
        messages: currentMessages.filter((m) => m.role !== 'system') as Array<{ role: 'user' | 'assistant'; content: string }>,
      })

      if (result.ok && result.value?.cancelled) {
        const partialContent = get().streamingContent || result.value.content || ''
        const newMessages: ChatMessage[] = partialContent
          ? [...currentMessages, { role: 'assistant' as const, content: partialContent, status: 'cancelled' as const }]
          : currentMessages
        set({
          messages: newMessages,
          isStreaming: false,
          isSending: false,
          streamingContent: '',
          activeToolCall: null,
          toolEvents: [],
          messagesByDomain: { ...get().messagesByDomain, [domainId]: newMessages },
        })
        return
      }

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
        const messageIndex = newMessages.length - 1
        const incomingProposals = result.value.proposals.map((p) => toStoredProposal(p, 'chat-send', messageIndex))
        const incomingRejected = (result.value.rejectedProposals ?? []).map((r) => toStoredRejected(r, 'chat-send', messageIndex))

        const newProposals = [...get().kbProposals, ...incomingProposals]
        const newRejected = [...get().rejectedProposals, ...incomingRejected]

        set({
          messages: newMessages,
          isStreaming: false,
          isSending: false,
          streamingContent: '',
          activeToolCall: null,
          toolEvents: [],
          kbProposals: newProposals,
          rejectedProposals: newRejected,
          messagesByDomain: { ...get().messagesByDomain, [domainId]: newMessages },
          proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals },
          rejectedProposalsByDomain: { ...get().rejectedProposalsByDomain, [domainId]: newRejected },
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
          isSending: false,
          streamingContent: '',
          activeToolCall: null,
          toolEvents: [],
          messagesByDomain: { ...get().messagesByDomain, [domainId]: newMessages },
        })
      }
    } finally {
      // Always clean up listeners
      unsubToolUse()
      window.domainOS.chat.offStreamChunk()
      window.domainOS.chat.offStreamDone()
      set({ isSending: false })
    }
  },

  async applyProposal(domainId, id) {
    const proposal = get().kbProposals.find((p) => p.localId === id)
    if (!proposal) return

    // Apply guardrail: reject delete without confirm, reject patch mode
    if (proposal.action === 'delete' && !proposal.confirm) return
    if (proposal.mode === 'patch') return

    await window.domainOS.kbUpdate.apply(domainId, proposal)

    const newProposals = get().kbProposals.filter((p) => p.localId !== id)
    set({
      kbProposals: newProposals,
      proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals },
    })
  },

  dismissProposal(id) {
    const domainId = get().activeDomainId
    const newProposals = get().kbProposals.filter((p) => p.localId !== id)
    set({
      kbProposals: newProposals,
      ...(domainId ? { proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals } } : {}),
    })
  },

  editProposal(id, newContent) {
    const domainId = get().activeDomainId
    const newProposals = get().kbProposals.map((p) =>
      p.localId === id ? { ...p, content: newContent, isEdited: true } : p,
    )
    set({
      kbProposals: newProposals,
      ...(domainId ? { proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals } } : {}),
    })
  },

  dismissRejectedProposal(id) {
    const domainId = get().activeDomainId
    const newRejected = get().rejectedProposals.filter((r) => r.id !== id)
    set({
      rejectedProposals: newRejected,
      ...(domainId ? { rejectedProposalsByDomain: { ...get().rejectedProposalsByDomain, [domainId]: newRejected } } : {}),
    })
  },

  clearMessages() {
    const domainId = get().activeDomainId
    set({
      messages: [],
      streamingContent: '',
      kbProposals: [],
      rejectedProposals: [],
      extractionError: null,
      extractionResult: null,
      ...(domainId ? {
        messagesByDomain: { ...get().messagesByDomain, [domainId]: [] },
        proposalsByDomain: { ...get().proposalsByDomain, [domainId]: [] },
        rejectedProposalsByDomain: { ...get().rejectedProposalsByDomain, [domainId]: [] },
      } : {}),
    })
  },

  async extractKbUpdates(domainId, content, messageIndex) {
    const state = get()

    // Rate limit: 2 seconds per domain
    const now = Date.now()
    const lastAt = state.lastExtractAt[domainId] ?? 0
    if (now - lastAt < 2000) return

    set({
      isExtracting: true,
      extractionError: null,
      extractionResult: null,
      lastExtractAt: { ...state.lastExtractAt, [domainId]: now },
    })

    try {
      const result = await window.domainOS.chat.extractKbUpdates({ domainId, content })

      if (result.ok && result.value) {
        const existingIds = new Set(get().kbProposals.map((p) => p.localId))
        const existingRejectedIds = new Set(get().rejectedProposals.map((r) => r.id))

        const incomingProposals = result.value.proposals
          .map((p) => toStoredProposal(p, 'extract', messageIndex))
          .filter((p) => !existingIds.has(p.localId))

        const incomingRejected = (result.value.rejectedProposals ?? [])
          .map((r) => toStoredRejected(r, 'extract', messageIndex))
          .filter((r) => !existingRejectedIds.has(r.id))

        const newProposals = [...get().kbProposals, ...incomingProposals]
        const newRejected = [...get().rejectedProposals, ...incomingRejected]

        const messageLabel = messageIndex != null ? `message #${messageIndex}` : 'last 10 messages'

        set({
          isExtracting: false,
          kbProposals: newProposals,
          rejectedProposals: newRejected,
          proposalsByDomain: { ...get().proposalsByDomain, [domainId]: newProposals },
          rejectedProposalsByDomain: { ...get().rejectedProposalsByDomain, [domainId]: newRejected },
          extractionResult: { proposalCount: incomingProposals.length, messageLabel },
        })
      } else {
        set({
          isExtracting: false,
          extractionError: result.error ?? 'Unknown error',
        })
      }
    } catch (err) {
      set({
        isExtracting: false,
        extractionError: err instanceof Error ? err.message : 'KB extraction failed',
      })
    }
  },

  clearExtractionError() {
    set({ extractionError: null })
  },

  clearExtractionResult() {
    set({ extractionResult: null })
  },
}))
