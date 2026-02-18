import { create } from 'zustand'
import type { Protocol } from '../../preload/api'

interface ProtocolState {
  protocols: Protocol[]
  loading: boolean

  fetchProtocols(domainId: string): Promise<void>
  createProtocol(input: { domainId: string; name: string; content: string }): Promise<Protocol | null>
  updateProtocol(id: string, input: { name?: string; content?: string }): Promise<boolean>
  deleteProtocol(id: string): Promise<boolean>
}

export const useProtocolStore = create<ProtocolState>((set, get) => ({
  protocols: [],
  loading: false,

  async fetchProtocols(domainId) {
    set({ loading: true })
    const result = await window.domainOS.protocol.list(domainId)
    if (result.ok && result.value) {
      set({ protocols: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async createProtocol(input) {
    const result = await window.domainOS.protocol.create(input)
    if (result.ok && result.value) {
      set({ protocols: [...get().protocols, result.value] })
      return result.value
    }
    return null
  },

  async updateProtocol(id, input) {
    const result = await window.domainOS.protocol.update(id, input)
    if (result.ok && result.value) {
      set({
        protocols: get().protocols.map((p) => (p.id === id ? result.value! : p)),
      })
      return true
    }
    return false
  },

  async deleteProtocol(id) {
    const result = await window.domainOS.protocol.delete(id)
    if (result.ok) {
      set({ protocols: get().protocols.filter((p) => p.id !== id) })
      return true
    }
    return false
  },
}))
