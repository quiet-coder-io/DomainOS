import { create } from 'zustand'
import type { DomainRelationship } from '../../preload/api'

interface RelationshipState {
  siblings: DomainRelationship[]
  loading: boolean

  fetchSiblings(domainId: string): Promise<void>
  addSibling(domainId: string, siblingDomainId: string): Promise<void>
  removeSibling(domainId: string, siblingDomainId: string): Promise<void>
}

export const useRelationshipStore = create<RelationshipState>((set, get) => ({
  siblings: [],
  loading: false,

  async fetchSiblings(domainId) {
    set({ loading: true })
    const result = await window.domainOS.relationship.getSiblings(domainId)
    if (result.ok && result.value) {
      set({ siblings: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async addSibling(domainId, siblingDomainId) {
    const result = await window.domainOS.relationship.addSibling(domainId, siblingDomainId)
    if (result.ok && result.value) {
      set({ siblings: [...get().siblings, result.value] })
    }
  },

  async removeSibling(domainId, siblingDomainId) {
    const result = await window.domainOS.relationship.removeSibling(domainId, siblingDomainId)
    if (result.ok) {
      set({
        siblings: get().siblings.filter(
          (s) => !(s.domainId === domainId && s.siblingDomainId === siblingDomainId),
        ),
      })
    }
  },
}))
