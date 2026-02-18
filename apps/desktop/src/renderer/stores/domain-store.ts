import { create } from 'zustand'
import type { Domain } from '../../preload/api'

interface DomainState {
  domains: Domain[]
  activeDomainId: string | null
  loading: boolean

  fetchDomains(): Promise<void>
  createDomain(input: { name: string; description?: string; kbPath: string; identity?: string; escalationTriggers?: string }): Promise<Domain | null>
  updateDomain(id: string, input: { name?: string; description?: string; kbPath?: string; identity?: string; escalationTriggers?: string }): Promise<boolean>
  setActiveDomain(id: string | null): void
  deleteDomain(id: string): Promise<void>
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
}))
