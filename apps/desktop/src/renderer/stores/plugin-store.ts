/**
 * Zustand store for plugin management.
 */

import { create } from 'zustand'
import type {
  PluginData,
  PluginInstallResultData,
  PluginDomainAssocData,
  MarketplaceEntryData,
} from '../../preload/api'

interface PluginState {
  plugins: PluginData[]
  marketplace: MarketplaceEntryData[]
  loading: boolean
  marketplaceLoading: boolean
  error: string | null
  lastFetchedAt: number

  fetchPlugins: (force?: boolean) => Promise<void>
  fetchMarketplace: () => Promise<void>
  installFromDirectory: (path: string) => Promise<PluginInstallResultData | null>
  uninstall: (id: string) => Promise<boolean>
  toggle: (id: string) => Promise<void>
  enableForDomain: (pluginId: string, domainId: string) => Promise<PluginDomainAssocData | null>
  disableForDomain: (pluginId: string, domainId: string) => Promise<void>
}

const CACHE_TTL = 5 * 60 * 1000 // 5 min

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  marketplace: [],
  loading: false,
  marketplaceLoading: false,
  error: null,
  lastFetchedAt: 0,

  async fetchPlugins(force = false) {
    const now = Date.now()
    if (!force && now - get().lastFetchedAt < CACHE_TTL && get().plugins.length > 0) return

    set({ loading: true, error: null })
    try {
      const result = await window.domainOS.plugin.list()
      if (result.ok) {
        set({ plugins: result.value ?? [], lastFetchedAt: now })
      } else {
        set({ error: result.error ?? 'Failed to fetch plugins' })
      }
    } finally {
      set({ loading: false })
    }
  },

  async fetchMarketplace() {
    set({ marketplaceLoading: true })
    try {
      const result = await window.domainOS.plugin.marketplaceList()
      if (result.ok) {
        set({ marketplace: result.value ?? [] })
      }
    } finally {
      set({ marketplaceLoading: false })
    }
  },

  async installFromDirectory(path: string) {
    const result = await window.domainOS.plugin.installFromDirectory(path)
    if (result.ok && result.value) {
      await get().fetchPlugins(true)
      return result.value
    }
    return null
  },

  async uninstall(id: string) {
    const result = await window.domainOS.plugin.uninstall(id)
    if (result.ok) {
      set((s) => ({ plugins: s.plugins.filter((p) => p.id !== id) }))
      return true
    }
    return false
  },

  async toggle(id: string) {
    const result = await window.domainOS.plugin.toggle(id)
    if (result.ok && result.value) {
      set((s) => ({
        plugins: s.plugins.map((p) => (p.id === id ? result.value! : p)),
      }))
    }
  },

  async enableForDomain(pluginId: string, domainId: string) {
    const result = await window.domainOS.plugin.enableForDomain(pluginId, domainId)
    if (result.ok && result.value) return result.value
    return null
  },

  async disableForDomain(pluginId: string, domainId: string) {
    await window.domainOS.plugin.disableForDomain(pluginId, domainId)
  },
}))
