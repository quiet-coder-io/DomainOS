import { create } from 'zustand'
import type { KBFile, KBSyncResult } from '../../preload/api'

interface KBState {
  files: KBFile[]
  loading: boolean
  lastSyncResult: KBSyncResult | null

  scanAndSync(domainId: string): Promise<void>
  fetchFiles(domainId: string): Promise<void>
}

export const useKBStore = create<KBState>((set) => ({
  files: [],
  loading: false,
  lastSyncResult: null,

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
}))
