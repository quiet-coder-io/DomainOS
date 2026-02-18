import { create } from 'zustand'
import type { Session } from '../../preload/api'

interface SessionState {
  activeSession: Session | null
  sessions: Session[]
  loading: boolean

  fetchActive(domainId: string): Promise<void>
  fetchList(domainId: string, limit?: number): Promise<void>
  endSession(id: string): Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  activeSession: null,
  sessions: [],
  loading: false,

  async fetchActive(domainId) {
    set({ loading: true })
    const result = await window.domainOS.session.getActive(domainId)
    if (result.ok) {
      set({ activeSession: result.value ?? null, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async fetchList(domainId, limit) {
    set({ loading: true })
    const result = await window.domainOS.session.list(domainId, limit)
    if (result.ok && result.value) {
      set({ sessions: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async endSession(id) {
    const result = await window.domainOS.session.end(id)
    if (result.ok && result.value) {
      set({
        activeSession: null,
        sessions: get().sessions.map((s) => (s.id === id ? result.value! : s)),
      })
    }
  },
}))
