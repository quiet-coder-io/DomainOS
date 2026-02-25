import { create } from 'zustand'
import type { KBUpdateProposal, RejectedProposal } from '../../preload/api'
import type { ToolUseEvent } from '../../shared/chat-types'
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
  attachments?: Array<{ filename: string; sizeBytes: number; sha256: string; truncated?: boolean }>
}

interface ExtractionResult {
  proposalCount: number
  messageLabel: string
}

// --- Helper: omit a key from an object (immutable) ---

function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  const copy = { ...obj }
  delete (copy as Record<string, unknown>)[key]
  return copy
}

interface ChatState {
  activeDomainId: string | null

  // Per-domain always
  messagesByDomain: Record<string, ChatMessage[]>
  proposalsByDomain: Record<string, StoredProposal[]>
  rejectedProposalsByDomain: Record<string, StoredRejectedProposal[]>
  streamingContentByDomain: Record<string, string>
  isStreamingByDomain: Record<string, boolean>
  isSendingByDomain: Record<string, boolean>
  activeToolCallByDomain: Record<string, ToolUseEvent | null>
  activeRequestIdByDomain: Record<string, string | null>

  // Request routing
  requestToDomain: Record<string, string> // requestId → domainId

  // Window-level in-flight tracking (enforces one-in-flight-per-window)
  activeWindowRequestId: string | null
  activeWindowDomainId: string | null

  // Extraction (already domain-aware)
  isExtracting: boolean
  lastExtractAt: Record<string, number>
  extractionError: string | null
  extractionResult: ExtractionResult | null

  // Actions
  switchDomain(domainId: string, domainName: string): void
  sendMessage(
    displayContent: string,
    llmContent: string,
    domainId: string,
    attachments?: Array<{ filename: string; sizeBytes: number; sha256: string; truncated?: boolean }>,
  ): Promise<void>
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

let listenersRegistered = false

export const useChatStore = create<ChatState>((set, get) => {
  // ── One-time IPC listener registration ──
  // Registered once at store creation. Route events by requestId → domainId.

  if (!listenersRegistered) {
    listenersRegistered = true

    window.domainOS.chat.onStreamChunk((data) => {
      const state = get()
      const domainId = state.requestToDomain[data.requestId]
      if (!domainId) return
      // Verify this is still the active request for this domain
      if (state.activeRequestIdByDomain[domainId] !== data.requestId) return
      set((s) => ({
        streamingContentByDomain: {
          ...s.streamingContentByDomain,
          [domainId]: (s.streamingContentByDomain[domainId] ?? '') + data.chunk,
        },
      }))
    })

    window.domainOS.chat.onToolUse((event) => {
      const state = get()
      const domainId = state.requestToDomain[event.requestId]
      if (!domainId) return
      if (state.activeRequestIdByDomain[domainId] !== event.requestId) return
      set((s) => ({
        activeToolCallByDomain: {
          ...s.activeToolCallByDomain,
          [domainId]: event.status === 'running'
            ? event
            : (s.activeToolCallByDomain[domainId]?.toolUseId === event.toolUseId
                ? null : s.activeToolCallByDomain[domainId]),
        },
      }))
    })

    // stream-done: AUTHORITATIVE lifecycle marker
    window.domainOS.chat.onStreamDone(({ requestId, cancelled: _cancelled }) => {
      const state = get()
      const domainId = state.requestToDomain[requestId]
      if (!domainId) return

      // If superseded, just clean mapping
      if (state.activeRequestIdByDomain[domainId] !== requestId) {
        set({ requestToDomain: omitKey(state.requestToDomain, requestId) })
        return
      }

      set((s) => ({
        requestToDomain: omitKey(s.requestToDomain, requestId),
        isStreamingByDomain: { ...s.isStreamingByDomain, [domainId]: false },
        isSendingByDomain: { ...s.isSendingByDomain, [domainId]: false },
        activeToolCallByDomain: { ...s.activeToolCallByDomain, [domainId]: null },
        activeRequestIdByDomain: { ...s.activeRequestIdByDomain, [domainId]: null },
        // Clear window-level tracking if this was the active window request
        ...(s.activeWindowRequestId === requestId ? {
          activeWindowRequestId: null,
          activeWindowDomainId: null,
        } : {}),
      }))
    })
  }

  return {
    activeDomainId: null,
    messagesByDomain: {},
    proposalsByDomain: {},
    rejectedProposalsByDomain: {},
    streamingContentByDomain: {},
    isStreamingByDomain: {},
    isSendingByDomain: {},
    activeToolCallByDomain: {},
    activeRequestIdByDomain: {},
    requestToDomain: {},
    activeWindowRequestId: null,
    activeWindowDomainId: null,
    isExtracting: false,
    lastExtractAt: {},
    extractionError: null,
    extractionResult: null,

    switchDomain(domainId, domainName) {
      set((s) => ({
        activeDomainId: domainId,
        ...(s.messagesByDomain[domainId] ? {} : {
          messagesByDomain: {
            ...s.messagesByDomain,
            [domainId]: [{ role: 'system' as const, content: domainName }],
          },
        }),
        extractionError: null,
        extractionResult: null,
      }))
    },

    cancelChat() {
      window.domainOS.chat.sendCancel()
      // Transport cancel is sender-scoped. onStreamDone handles flag cleanup.
    },

    async sendMessage(displayContent, llmContent, domainId, attachments) {
      const state = get()

      // Send guard: block any send while any request is in-flight
      if (state.activeWindowRequestId) return

      const requestId = crypto.randomUUID()

      // Store display content + attachment metadata (never file contents)
      const userMessage: ChatMessage = {
        role: 'user',
        content: displayContent,
        ...(attachments?.length ? { attachments } : {}),
      }
      const currentMessages = [...(state.messagesByDomain[domainId] ?? []), userMessage]

      set((s) => ({
        messagesByDomain: { ...s.messagesByDomain, [domainId]: currentMessages },
        isStreamingByDomain: { ...s.isStreamingByDomain, [domainId]: true },
        isSendingByDomain: { ...s.isSendingByDomain, [domainId]: true },
        streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
        activeToolCallByDomain: { ...s.activeToolCallByDomain, [domainId]: null },
        activeRequestIdByDomain: { ...s.activeRequestIdByDomain, [domainId]: requestId },
        requestToDomain: { ...s.requestToDomain, [requestId]: domainId },
        activeWindowRequestId: requestId,
        activeWindowDomainId: domainId,
      }))

      try {
        // Build fresh IPC messages array — use llmContent for the last user message
        const ipcMessages = currentMessages
          .filter((m) => m.role !== 'system')
          .map((m, _i, arr) => {
            // For the last message (just added), use llmContent instead of displayContent
            if (m === userMessage) {
              return { role: m.role as 'user' | 'assistant', content: llmContent }
            }
            return { role: m.role as 'user' | 'assistant', content: m.content }
          })

        const result = await window.domainOS.chat.send({
          requestId,
          domainId,
          messages: ipcMessages,
        })

        if (result.ok && result.value?.cancelled) {
          const s = get()
          const partialContent = s.streamingContentByDomain[domainId] || result.value.content || ''
          const newMessages: ChatMessage[] = partialContent
            ? [...currentMessages, { role: 'assistant' as const, content: partialContent, status: 'cancelled' as const }]
            : currentMessages
          set((s) => ({
            messagesByDomain: { ...s.messagesByDomain, [domainId]: newMessages },
            streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
          }))
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

          set((s) => {
            const newProposals = [...(s.proposalsByDomain[domainId] ?? []), ...incomingProposals]
            const newRejected = [...(s.rejectedProposalsByDomain[domainId] ?? []), ...incomingRejected]
            return {
              messagesByDomain: { ...s.messagesByDomain, [domainId]: newMessages },
              streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
              proposalsByDomain: { ...s.proposalsByDomain, [domainId]: newProposals },
              rejectedProposalsByDomain: { ...s.rejectedProposalsByDomain, [domainId]: newRejected },
            }
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
          set((s) => ({
            messagesByDomain: { ...s.messagesByDomain, [domainId]: newMessages },
            streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
          }))
        }
      } catch {
        // Unexpected error — clean up streaming state
        set((s) => ({
          streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
        }))
      }
      // Note: isStreaming/isSending/activeToolCall/activeRequestId are NOT touched here.
      // onStreamDone handles those — it's the authoritative lifecycle marker.
    },

    async applyProposal(domainId, id) {
      const proposals = get().proposalsByDomain[domainId] ?? []
      const proposal = proposals.find((p) => p.localId === id)
      if (!proposal) return

      // Apply guardrail: reject delete without confirm, reject patch mode
      if (proposal.action === 'delete' && !proposal.confirm) return
      if (proposal.mode === 'patch') return

      await window.domainOS.kbUpdate.apply(domainId, proposal)

      const newProposals = (get().proposalsByDomain[domainId] ?? []).filter((p) => p.localId !== id)
      set((s) => ({
        proposalsByDomain: { ...s.proposalsByDomain, [domainId]: newProposals },
      }))
    },

    dismissProposal(id) {
      const domainId = get().activeDomainId
      if (!domainId) return
      const newProposals = (get().proposalsByDomain[domainId] ?? []).filter((p) => p.localId !== id)
      set((s) => ({
        proposalsByDomain: { ...s.proposalsByDomain, [domainId]: newProposals },
      }))
    },

    editProposal(id, newContent) {
      const domainId = get().activeDomainId
      if (!domainId) return
      const newProposals = (get().proposalsByDomain[domainId] ?? []).map((p) =>
        p.localId === id ? { ...p, content: newContent, isEdited: true } : p,
      )
      set((s) => ({
        proposalsByDomain: { ...s.proposalsByDomain, [domainId]: newProposals },
      }))
    },

    dismissRejectedProposal(id) {
      const domainId = get().activeDomainId
      if (!domainId) return
      const newRejected = (get().rejectedProposalsByDomain[domainId] ?? []).filter((r) => r.id !== id)
      set((s) => ({
        rejectedProposalsByDomain: { ...s.rejectedProposalsByDomain, [domainId]: newRejected },
      }))
    },

    clearMessages() {
      const domainId = get().activeDomainId
      if (!domainId) return
      set((s) => ({
        messagesByDomain: { ...s.messagesByDomain, [domainId]: [] },
        streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
        proposalsByDomain: { ...s.proposalsByDomain, [domainId]: [] },
        rejectedProposalsByDomain: { ...s.rejectedProposalsByDomain, [domainId]: [] },
        extractionError: null,
        extractionResult: null,
      }))
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
          const currentProposals = get().proposalsByDomain[domainId] ?? []
          const currentRejected = get().rejectedProposalsByDomain[domainId] ?? []
          const existingIds = new Set(currentProposals.map((p) => p.localId))
          const existingRejectedIds = new Set(currentRejected.map((r) => r.id))

          const incomingProposals = result.value.proposals
            .map((p) => toStoredProposal(p, 'extract', messageIndex))
            .filter((p) => !existingIds.has(p.localId))

          const incomingRejected = (result.value.rejectedProposals ?? [])
            .map((r) => toStoredRejected(r, 'extract', messageIndex))
            .filter((r) => !existingRejectedIds.has(r.id))

          const newProposals = [...currentProposals, ...incomingProposals]
          const newRejected = [...currentRejected, ...incomingRejected]

          const messageLabel = messageIndex != null ? `message #${messageIndex}` : 'last 10 messages'

          set((s) => ({
            isExtracting: false,
            proposalsByDomain: { ...s.proposalsByDomain, [domainId]: newProposals },
            rejectedProposalsByDomain: { ...s.rejectedProposalsByDomain, [domainId]: newRejected },
            extractionResult: { proposalCount: incomingProposals.length, messageLabel },
          }))
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
  }
})
