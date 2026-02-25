import { create } from 'zustand'
import type { DomainTag } from '../../preload/api'

interface TagState {
  tagsByDomain: Record<string, DomainTag[]>
  distinctValuesByKey: Record<string, Array<{ value: string; count: number }>>
  activeFilters: Record<string, string[]>
  filteredDomainIds: string[] | null

  fetchAllTags(): Promise<void>
  fetchDistinctValues(key: string): Promise<Array<{ value: string; count: number }>>
  setTagsForDomain(domainId: string, tags: Array<{ key: string; value: string }>): Promise<void>
  toggleFilter(key: string, value: string): void
  clearFilters(): void
}

let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

export const useTagStore = create<TagState>((set, get) => ({
  tagsByDomain: {},
  distinctValuesByKey: {},
  activeFilters: {},
  filteredDomainIds: null,

  async fetchAllTags() {
    try {
      const result = await window.domainOS.tags.all()
      if (result.ok && result.value) {
        set({ tagsByDomain: result.value })
      }
    } catch (err) {
      console.error('fetchAllTags error:', err)
    }
  },

  async fetchDistinctValues(key: string) {
    const cached = get().distinctValuesByKey[key]
    if (cached) return cached

    try {
      const result = await window.domainOS.tags.distinctValues(key)
      if (result.ok && result.value) {
        set((s) => ({
          distinctValuesByKey: { ...s.distinctValuesByKey, [key]: result.value! },
        }))
        return result.value
      }
    } catch (err) {
      console.error('fetchDistinctValues error:', err)
    }
    return []
  },

  async setTagsForDomain(domainId, tags) {
    try {
      await window.domainOS.tags.set(domainId, tags)
      await get().fetchAllTags()
      // Invalidate cache and re-fetch so filter dropdowns update
      set({ distinctValuesByKey: {} })
      const keys = ['property', 'contact', 'type']
      await Promise.all(keys.map((k) => get().fetchDistinctValues(k)))
    } catch (err) {
      console.error('setTagsForDomain error:', err)
    }
  },

  toggleFilter(key, value) {
    set((s) => {
      const current = s.activeFilters[key] ?? []
      const idx = current.indexOf(value)
      const updated = idx >= 0
        ? current.filter((v) => v !== value)
        : [...current, value]
      const newFilters = { ...s.activeFilters, [key]: updated }

      // Clean up empty arrays
      if (updated.length === 0) {
        delete newFilters[key]
      }

      return { activeFilters: newFilters }
    })

    // Debounced IPC call
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    filterDebounceTimer = setTimeout(async () => {
      const { activeFilters } = get()
      try {
        const result = await window.domainOS.tags.filter(activeFilters)
        if (result.ok) {
          set({ filteredDomainIds: result.value ?? null })
        }
      } catch (err) {
        console.error('tags:filter error:', err)
      }
    }, 150)
  },

  clearFilters() {
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    set({ activeFilters: {}, filteredDomainIds: null })
  },
}))
