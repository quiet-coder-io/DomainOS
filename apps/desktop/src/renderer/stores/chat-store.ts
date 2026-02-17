import { create } from 'zustand'
import type { KBUpdateProposal } from '../../preload/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  kbProposals: KBUpdateProposal[]

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
      messages: currentMessages,
      apiKey,
    })

    // Clean up listeners
    window.domainOS.chat.offStreamChunk()
    window.domainOS.chat.offStreamDone()

    if (result.ok && result.value) {
      set({
        messages: [...currentMessages, { role: 'assistant', content: result.value.content }],
        isStreaming: false,
        streamingContent: '',
        kbProposals: [...get().kbProposals, ...result.value.proposals],
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
      set({
        messages: [
          ...currentMessages,
          { role: 'assistant', content: `Error: ${errorContent}` },
        ],
        isStreaming: false,
        streamingContent: '',
      })
    }
  },

  async applyProposal(domainId, index) {
    const proposal = get().kbProposals[index]
    if (!proposal) return

    await window.domainOS.kbUpdate.apply(domainId, proposal)

    set((s) => ({
      kbProposals: s.kbProposals.filter((_, i) => i !== index),
    }))
  },

  dismissProposal(index) {
    set((s) => ({
      kbProposals: s.kbProposals.filter((_, i) => i !== index),
    }))
  },

  clearMessages() {
    set({ messages: [], streamingContent: '', kbProposals: [] })
  },
}))
