import { create } from 'zustand'
import type { GapFlag } from '../../preload/api'

interface GapFlagState {
  flags: GapFlag[]
  loading: boolean

  fetchOpen(domainId: string): Promise<void>
  fetchAll(domainId: string, limit?: number): Promise<void>
  acknowledge(id: string): Promise<void>
  resolve(id: string): Promise<void>
}

export const useGapFlagStore = create<GapFlagState>((set, get) => ({
  flags: [],
  loading: false,

  async fetchOpen(domainId) {
    set({ loading: true })
    const result = await window.domainOS.gapFlag.open(domainId)
    if (result.ok && result.value) {
      set({ flags: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async fetchAll(domainId, limit) {
    set({ loading: true })
    const result = await window.domainOS.gapFlag.list(domainId, limit)
    if (result.ok && result.value) {
      set({ flags: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async acknowledge(id) {
    const result = await window.domainOS.gapFlag.acknowledge(id)
    if (result.ok && result.value) {
      set({ flags: get().flags.map((f) => (f.id === id ? result.value! : f)) })
    }
  },

  async resolve(id) {
    const result = await window.domainOS.gapFlag.resolve(id)
    if (result.ok && result.value) {
      set({ flags: get().flags.map((f) => (f.id === id ? result.value! : f)) })
    }
  },
}))
