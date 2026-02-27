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

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  id?: string
  status?: 'cancelled' | 'error'
  metadata?: Record<string, unknown>
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
  switchDomain(domainId: string, domainName: string): Promise<void>
  sendMessage(
    displayContent: string,
    llmContent: string,
    domainId: string,
    attachments?: Array<{ filename: string; sizeBytes: number; sha256: string; truncated?: boolean }>,
    activeSkillId?: string,
  ): Promise<void>
  cancelChat(): void
  applyProposal(domainId: string, id: string): Promise<void>
  dismissProposal(id: string): void
  editProposal(id: string, newContent: string): void
  dismissRejectedProposal(id: string): void
  clearMessages(): Promise<void>
  extractKbUpdates(domainId: string, content: string, messageIndex?: number): Promise<void>
  extractKbUpdatesFromIndex(domainId: string, messageIndex: number): Promise<void>
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

// Module-level clear tokens — outside Zustand to avoid re-renders.
// Each domain gets a token bumped on clear; in-flight persistOnce checks it.
const clearTokenByDomain = new Map<string, string>()

function getClearToken(domainId: string): string {
  let t = clearTokenByDomain.get(domainId)
  if (!t) { t = crypto.randomUUID(); clearTokenByDomain.set(domainId, t) }
  return t
}

function bumpClearToken(domainId: string): void {
  clearTokenByDomain.set(domainId, crypto.randomUUID())
}

// Per-domain message cache: tracks whether we've loaded from DB this session
const loadedDomains = new Set<string>()

// --- RAF-batched streaming chunk buffer ---
// Accumulates chunks between animation frames so the store updates at most once per frame.
let chunkBuffer: Record<string, { requestId: string; text: string }> = {}
let chunkRafId: number | null = null
// Forward declarations — assigned once inside store creation where get/set are available
let storeGet: () => ChatState
let storeSet: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void

function flushChunks(): void {
  const buffered = chunkBuffer
  chunkBuffer = {}
  chunkRafId = null

  const state = storeGet()
  const updates: Record<string, string> = {}
  for (const [domainId, { requestId, text }] of Object.entries(buffered)) {
    if (state.activeRequestIdByDomain[domainId] === requestId) {
      updates[domainId] = text
    }
  }

  if (Object.keys(updates).length === 0) return
  storeSet((s) => {
    const next = { ...s.streamingContentByDomain }
    for (const [domainId, chunk] of Object.entries(updates)) {
      next[domainId] = (next[domainId] ?? '') + chunk
    }
    return { streamingContentByDomain: next }
  })
}

function synchronousFlush(): void {
  if (chunkRafId) { cancelAnimationFrame(chunkRafId); chunkRafId = null }
  flushChunks()
}

let listenersRegistered = false

export const useChatStore = create<ChatState>((set, get) => {
  // Wire up module-level refs to this store's get/set
  storeGet = get
  storeSet = set as typeof storeSet
  // ── One-time IPC listener registration ──
  // Registered once at store creation. Route events by requestId → domainId.

  if (!listenersRegistered) {
    listenersRegistered = true

    window.domainOS.chat.onStreamChunk((data) => {
      const state = get()
      const domainId = state.requestToDomain[data.requestId]
      if (!domainId) return
      if (state.activeRequestIdByDomain[domainId] !== data.requestId) return

      // Buffer chunks — flush on next animation frame
      const existing = chunkBuffer[domainId]
      const sameRequest = existing && existing.requestId === data.requestId
      chunkBuffer[domainId] = {
        requestId: data.requestId,
        text: (sameRequest ? existing.text : '') + data.chunk,
      }
      if (!chunkRafId) chunkRafId = requestAnimationFrame(flushChunks)
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
      // Flush any buffered chunks before clearing streaming state
      synchronousFlush()

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

    async switchDomain(domainId, domainName) {
      const s = get()

      // Already cached in memory → use it
      if (s.messagesByDomain[domainId] || loadedDomains.has(domainId)) {
        set({
          activeDomainId: domainId,
          extractionError: null,
          extractionResult: null,
        })
        return
      }

      // Try loading from DB
      loadedDomains.add(domainId)
      try {
        const result = await window.domainOS.chatHistory.loadHistory(domainId)
        const systemMsg: ChatMessage = { role: 'system', content: domainName }

        if (result.ok && result.value && result.value.length > 0) {
          const restored: ChatMessage[] = [
            systemMsg,
            ...result.value.map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
              id: m.id,
              ...(m.status ? { status: m.status as 'cancelled' | 'error' } : {}),
              ...(m.metadata && Object.keys(m.metadata).length > 0 ? { metadata: m.metadata } : {}),
            })),
          ]
          set((s2) => ({
            activeDomainId: domainId,
            messagesByDomain: { ...s2.messagesByDomain, [domainId]: restored },
            extractionError: null,
            extractionResult: null,
          }))
        } else {
          set((s2) => ({
            activeDomainId: domainId,
            messagesByDomain: { ...s2.messagesByDomain, [domainId]: [systemMsg] },
            extractionError: null,
            extractionResult: null,
          }))
        }
      } catch {
        // DB load failed — start with empty
        set((s2) => ({
          activeDomainId: domainId,
          messagesByDomain: { ...s2.messagesByDomain, [domainId]: [{ role: 'system' as const, content: domainName }] },
          extractionError: null,
          extractionResult: null,
        }))
      }
    },

    cancelChat() {
      synchronousFlush()
      window.domainOS.chat.sendCancel()
      // Transport cancel is sender-scoped. onStreamDone handles flag cleanup.
    },

    async sendMessage(displayContent, llmContent, domainId, attachments, activeSkillId) {
      // Flush any buffered chunks from a previous stream before starting a new one
      synchronousFlush()

      const state = get()

      // Send guard: block any send while any request is in-flight
      if (state.activeWindowRequestId) return

      const requestId = crypto.randomUUID()

      // Renderer-generated IDs and timestamps for persistence
      const userMsgId = crypto.randomUUID()
      const assistantMsgId = crypto.randomUUID()
      const userCreatedAt = new Date().toISOString()
      const runDomainId = domainId
      const runClearToken = getClearToken(domainId)
      let persisted = false

      // Persist helper — runs at most once, checks clear token + domain
      function persistOnce(msgs: Array<{ id: string; role: string; content: string; status?: string | null; metadata?: Record<string, unknown>; createdAt: string }>) {
        if (persisted) return
        if (getClearToken(runDomainId) !== runClearToken) return
        if (get().activeDomainId !== runDomainId) {
          // Still persist even if switched away — just don't block
        }
        persisted = true
        window.domainOS.chatHistory.persistMessages(runDomainId, msgs).catch(() => {
          // Non-fatal: persistence failed
        })
      }

      // Store display content + attachment metadata (never file contents)
      const userMessage: ChatMessage = {
        role: 'user',
        content: displayContent,
        id: userMsgId,
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
          .map((m) => {
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
          ...(activeSkillId ? { activeSkillId } : {}),
        })

        if (result.ok && result.value?.cancelled) {
          const s = get()
          const partialContent = s.streamingContentByDomain[domainId] || result.value.content || ''
          const newMessages: ChatMessage[] = partialContent
            ? [...currentMessages, { role: 'assistant' as const, content: partialContent, id: assistantMsgId, status: 'cancelled' as const }]
            : currentMessages
          set((s) => ({
            messagesByDomain: { ...s.messagesByDomain, [domainId]: newMessages },
            streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
          }))
          // Persist: user + cancelled assistant
          if (partialContent) {
            persistOnce([
              { id: userMsgId, role: 'user', content: displayContent, createdAt: userCreatedAt },
              { id: assistantMsgId, role: 'assistant', content: partialContent, status: 'cancelled', createdAt: new Date().toISOString() },
            ])
          } else {
            persistOnce([{ id: userMsgId, role: 'user', content: displayContent, createdAt: userCreatedAt }])
          }
          return
        }

        if (result.ok && result.value) {
          const assistantMsg: ChatMessage = {
            role: 'assistant' as const,
            content: result.value.content,
            id: assistantMsgId,
            stopBlocks: result.value.stopBlocks,
            gapFlags: result.value.gapFlags,
            decisions: result.value.decisions,
          }
          const newMessages = [...currentMessages, assistantMsg]
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
          // Persist: user + success assistant with metadata
          const meta: Record<string, unknown> = {}
          if (result.value.stopBlocks?.length) meta.stopBlocks = result.value.stopBlocks
          if (result.value.gapFlags?.length) meta.gapFlags = result.value.gapFlags
          if (result.value.decisions?.length) meta.decisions = result.value.decisions
          persistOnce([
            { id: userMsgId, role: 'user', content: displayContent, createdAt: userCreatedAt },
            { id: assistantMsgId, role: 'assistant', content: result.value.content, metadata: meta, createdAt: new Date().toISOString() },
          ])
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
            { role: 'assistant' as const, content: `Error: ${errorContent}`, id: assistantMsgId, status: 'error' as const },
          ]
          set((s) => ({
            messagesByDomain: { ...s.messagesByDomain, [domainId]: newMessages },
            streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
          }))
          // Persist: user + error assistant
          persistOnce([
            { id: userMsgId, role: 'user', content: displayContent, createdAt: userCreatedAt },
            { id: assistantMsgId, role: 'assistant', content: `Error: ${errorContent}`, status: 'error', metadata: { errorMessage: result.error ?? 'Unknown error occurred' }, createdAt: new Date().toISOString() },
          ])
        }
      } catch (err) {
        // Unexpected error — clean up streaming state + persist pair
        set((s) => ({
          streamingContentByDomain: { ...s.streamingContentByDomain, [domainId]: '' },
        }))
        persistOnce([
          { id: userMsgId, role: 'user', content: displayContent, createdAt: userCreatedAt },
          { id: assistantMsgId, role: 'assistant', content: `Error: ${String(err)}`, status: 'error', metadata: { errorMessage: String(err) }, createdAt: new Date().toISOString() },
        ])
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

    async clearMessages() {
      const domainId = get().activeDomainId
      if (!domainId) return

      // Bump clear token first — prevents any in-flight persistOnce from writing
      bumpClearToken(domainId)

      // Cancel any active stream (best-effort)
      if (get().isStreamingByDomain[domainId]) {
        window.domainOS.chat.sendCancel()
      }

      // Clear DB (awaited to prevent ghost reload race)
      await window.domainOS.chatHistory.clearHistory(domainId).catch(() => {})

      // Drop in-memory cache so next switchDomain reloads from DB truth
      loadedDomains.delete(domainId)

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

    async extractKbUpdatesFromIndex(domainId, messageIndex) {
      const messages = get().messagesByDomain[domainId] ?? []
      const msg = messages[messageIndex]
      if (!msg || msg.role !== 'assistant') return
      return get().extractKbUpdates(domainId, msg.content, messageIndex)
    },

    clearExtractionError() {
      set({ extractionError: null })
    },

    clearExtractionResult() {
      set({ extractionResult: null })
    },
  }
})
