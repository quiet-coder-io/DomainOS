import { create } from 'zustand'
import type { AdvisoryArtifact, AdvisoryType, AdvisoryStatus } from '../../preload/api'

interface AdvisoryState {
  artifacts: AdvisoryArtifact[]
  loading: boolean
  filter: { status?: AdvisoryStatus; type?: AdvisoryType }

  fetchArtifacts(domainId: string): Promise<void>
  setFilter(filter: { status?: AdvisoryStatus; type?: AdvisoryType }): void
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
}

export const useAdvisoryStore = create<AdvisoryState>((set, get) => ({
  artifacts: [],
  loading: false,
  filter: { status: 'active' },

  async fetchArtifacts(domainId) {
    set({ loading: true })
    const { filter } = get()
    const result = await window.domainOS.advisory.list(domainId, {
      status: filter.status,
      type: filter.type,
      limit: 50,
    })
    if (result.ok && result.value) {
      set({ artifacts: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  setFilter(filter) {
    set({ filter })
  },

  async archive(id) {
    const result = await window.domainOS.advisory.archive(id)
    if (result.ok && result.value) {
      set({ artifacts: get().artifacts.map((a) => (a.id === id ? result.value! : a)) })
    }
  },

  async unarchive(id) {
    const result = await window.domainOS.advisory.unarchive(id)
    if (result.ok && result.value) {
      set({ artifacts: get().artifacts.map((a) => (a.id === id ? result.value! : a)) })
    }
  },

  async rename(id, title) {
    const result = await window.domainOS.advisory.rename(id, title)
    if (result.ok && result.value) {
      set({ artifacts: get().artifacts.map((a) => (a.id === id ? result.value! : a)) })
    }
  },
}))
