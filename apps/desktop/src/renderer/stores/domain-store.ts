import { create } from 'zustand'
import type { Domain } from '../../preload/api'

interface DomainState {
  domains: Domain[]
  activeDomainId: string | null
  loading: boolean

  fetchDomains(): Promise<void>
  createDomain(input: {
    name: string; description?: string; kbPath: string; identity?: string; escalationTriggers?: string; allowGmail?: boolean
    modelProvider?: string | null; modelName?: string | null; forceToolAttempt?: boolean
  }): Promise<Domain | null>
  updateDomain(id: string, input: {
    name?: string; description?: string; kbPath?: string; identity?: string; escalationTriggers?: string; allowGmail?: boolean
    modelProvider?: string | null; modelName?: string | null; forceToolAttempt?: boolean
  }): Promise<boolean>
  setActiveDomain(id: string | null): void
  deleteDomain(id: string): Promise<void>
  reorderDomain(fromIndex: number, toIndex: number): Promise<void>
}

export const useDomainStore = create<DomainState>((set, get) => ({
  domains: [],
  activeDomainId: null,
  loading: false,

  async fetchDomains() {
    set({ loading: true })
    try {
      const result = await window.domainOS.domain.list()
      if (result.ok) {
        set({ domains: result.value ?? [], loading: false })
      } else {
        console.error('fetchDomains failed:', result.error)
        set({ loading: false })
      }
    } catch (err) {
      console.error('fetchDomains error:', err)
      set({ loading: false })
    }
  },

  async createDomain(input) {
    const result = await window.domainOS.domain.create(input)
    if (result.ok && result.value) {
      await get().fetchDomains()
      return result.value
    }
    return null
  },

  async updateDomain(id, input) {
    const result = await window.domainOS.domain.update(id, input)
    if (result.ok) {
      await get().fetchDomains()
      return true
    }
    console.error('updateDomain failed:', result.error)
    return false
  },

  setActiveDomain(id) {
    set({ activeDomainId: id })
  },

  async deleteDomain(id) {
    await window.domainOS.domain.delete(id)
    const state = get()
    if (state.activeDomainId === id) {
      set({ activeDomainId: null })
    }
    await state.fetchDomains()
  },

  async reorderDomain(fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    const current = [...get().domains]
    const [moved] = current.splice(fromIndex, 1)
    current.splice(toIndex, 0, moved)
    // Optimistic update
    set({ domains: current })
    // Persist
    const result = await window.domainOS.domain.reorder(current.map((d) => d.id))
    if (!result.ok) {
      console.error('reorderDomain failed:', result.error)
      await get().fetchDomains()
    }
  },
}))
