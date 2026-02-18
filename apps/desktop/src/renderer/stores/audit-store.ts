import { create } from 'zustand'
import type { AuditEntry } from '../../preload/api'

interface AuditState {
  entries: AuditEntry[]
  loading: boolean

  fetchEntries(domainId: string, limit?: number): Promise<void>
  fetchByType(domainId: string, eventType: string, limit?: number): Promise<void>
}

export const useAuditStore = create<AuditState>((set) => ({
  entries: [],
  loading: false,

  async fetchEntries(domainId, limit) {
    set({ loading: true })
    const result = await window.domainOS.audit.list(domainId, limit)
    if (result.ok && result.value) {
      set({ entries: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async fetchByType(domainId, eventType, limit) {
    set({ loading: true })
    const result = await window.domainOS.audit.listByType(domainId, eventType, limit)
    if (result.ok && result.value) {
      set({ entries: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },
}))
