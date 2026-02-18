import { create } from 'zustand'
import type { Decision } from '../../preload/api'

interface DecisionState {
  decisions: Decision[]
  loading: boolean

  fetchActive(domainId: string): Promise<void>
  fetchAll(domainId: string, limit?: number): Promise<void>
  reject(id: string): Promise<void>
}

export const useDecisionStore = create<DecisionState>((set, get) => ({
  decisions: [],
  loading: false,

  async fetchActive(domainId) {
    set({ loading: true })
    const result = await window.domainOS.decision.active(domainId)
    if (result.ok && result.value) {
      set({ decisions: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async fetchAll(domainId, limit) {
    set({ loading: true })
    const result = await window.domainOS.decision.list(domainId, limit)
    if (result.ok && result.value) {
      set({ decisions: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async reject(id) {
    const result = await window.domainOS.decision.reject(id)
    if (result.ok && result.value) {
      set({ decisions: get().decisions.map((d) => (d.id === id ? result.value! : d)) })
    }
  },
}))
