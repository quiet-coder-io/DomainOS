import { create } from 'zustand'
import type { DomainRelationship, RelationshipView, DependencyType } from '../../preload/api'

interface RelationshipState {
  siblings: DomainRelationship[]
  relationships: RelationshipView[]
  loading: boolean

  fetchSiblings(domainId: string): Promise<void>
  fetchRelationships(domainId: string): Promise<void>
  addRelationship(
    fromDomainId: string,
    toDomainId: string,
    options?: {
      relationshipType?: string
      dependencyType?: DependencyType
      description?: string
      reciprocate?: boolean
      reciprocalType?: DependencyType
    },
  ): Promise<boolean>
  addSibling(domainId: string, siblingDomainId: string): Promise<void>
  removeRelationship(fromDomainId: string, toDomainId: string): Promise<void>
  removeSibling(domainId: string, siblingDomainId: string): Promise<void>
}

export const useRelationshipStore = create<RelationshipState>((set, get) => ({
  siblings: [],
  relationships: [],
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

  async fetchRelationships(domainId) {
    set({ loading: true })
    const result = await window.domainOS.relationship.getRelationships(domainId)
    if (result.ok && result.value) {
      set({ relationships: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async addRelationship(fromDomainId, toDomainId, options) {
    const result = await window.domainOS.relationship.addRelationship(fromDomainId, toDomainId, options)
    if (result.ok) {
      // Refresh the full relationship list to capture both directions
      await get().fetchRelationships(fromDomainId)
      return true
    }
    return false
  },

  async addSibling(domainId, siblingDomainId) {
    const result = await window.domainOS.relationship.addSibling(domainId, siblingDomainId)
    if (result.ok && result.value) {
      set({ siblings: [...get().siblings, result.value] })
    }
  },

  async removeRelationship(fromDomainId, toDomainId) {
    const result = await window.domainOS.relationship.removeRelationship(fromDomainId, toDomainId)
    if (result.ok) {
      await get().fetchRelationships(fromDomainId)
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
