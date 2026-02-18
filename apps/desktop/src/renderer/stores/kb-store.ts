import { create } from 'zustand'
import type { KBFile, KBSyncResult } from '../../preload/api'

interface KBState {
  files: KBFile[]
  loading: boolean
  lastSyncResult: KBSyncResult | null
  watchingDomainId: string | null

  scanAndSync(domainId: string): Promise<KBSyncResult | null>
  fetchFiles(domainId: string): Promise<void>
  startWatching(domainId: string): void
  stopWatching(): void
}

export const useKBStore = create<KBState>((set, get) => ({
  files: [],
  loading: false,
  lastSyncResult: null,
  watchingDomainId: null,

  async scanAndSync(domainId) {
    set({ loading: true })
    const result = await window.domainOS.kb.scan(domainId)
    if (result.ok && result.value) {
      set({ lastSyncResult: result.value })
    }
    // Refresh file list after sync
    const files = await window.domainOS.kb.files(domainId)
    if (files.ok && files.value) {
      set({ files: files.value, loading: false })
    } else {
      set({ loading: false })
    }
    return result.ok ? (result.value ?? null) : null
  },

  async fetchFiles(domainId) {
    set({ loading: true })
    const result = await window.domainOS.kb.files(domainId)
    if (result.ok && result.value) {
      set({ files: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  startWatching(domainId) {
    const { watchingDomainId } = get()
    if (watchingDomainId === domainId) return

    // Stop previous watcher
    if (watchingDomainId) {
      window.domainOS.kb.watchStop(watchingDomainId)
      window.domainOS.kb.offFilesChanged()
    }

    window.domainOS.kb.onFilesChanged((changedDomainId) => {
      const state = get()
      if (changedDomainId === state.watchingDomainId) {
        state.fetchFiles(changedDomainId)
      }
    })

    window.domainOS.kb.watchStart(domainId)
    set({ watchingDomainId: domainId })
  },

  stopWatching() {
    const { watchingDomainId } = get()
    if (watchingDomainId) {
      window.domainOS.kb.watchStop(watchingDomainId)
      window.domainOS.kb.offFilesChanged()
      set({ watchingDomainId: null })
    }
  },
}))
