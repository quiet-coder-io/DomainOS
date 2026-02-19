import { create } from 'zustand'
import type { KBFile, KBSyncResult } from '../../preload/api'

interface KBState {
  files: KBFile[]
  filesDomainId: string | null
  scanning: boolean
  lastSyncResult: KBSyncResult | null
  watchingDomainId: string | null
  lastScanAttemptAt: Record<string, number>
  scanSeq: Record<string, number>

  scanAndSync(domainId: string): Promise<KBSyncResult | null>
  fetchFiles(domainId: string): Promise<void>
  startWatching(domainId: string): void
  stopWatching(): void
}

export const useKBStore = create<KBState>((set, get) => ({
  files: [],
  filesDomainId: null,
  scanning: false,
  lastSyncResult: null,
  watchingDomainId: null,
  lastScanAttemptAt: {},
  scanSeq: {},

  async scanAndSync(domainId) {
    const token = (get().scanSeq[domainId] ?? 0) + 1
    // Record attempt timestamp immediately — even if scan throws,
    // cooldown prevents retry thrashing on flaky IPC.
    set((s) => ({
      scanning: true,
      scanSeq: { ...s.scanSeq, [domainId]: token },
      lastScanAttemptAt: { ...s.lastScanAttemptAt, [domainId]: Date.now() },
    }))

    let syncResult: KBSyncResult | null = null
    try {
      const result = await window.domainOS.kb.scan(domainId)

      // Latest-only guard: a newer scan started — let it own state.
      if ((get().scanSeq[domainId] ?? 0) !== token) return null

      if (result.ok && result.value) {
        syncResult = result.value
        set({ lastSyncResult: result.value })
      }

      const files = await window.domainOS.kb.files(domainId)

      if ((get().scanSeq[domainId] ?? 0) !== token) return null

      if (files.ok && Array.isArray(files.value)) {
        set({ files: files.value, filesDomainId: domainId })
      }
    } finally {
      // Single cleanup point. If we still own the token, clear scanning.
      // If superseded, the newer scan owns scanning — leave it alone.
      if ((get().scanSeq[domainId] ?? 0) === token) {
        set({ scanning: false })
      }
    }
    return syncResult
  },

  async fetchFiles(domainId) {
    // Snapshot current scan token — don't increment.
    // If a scan starts while this fetch is in flight, the scan wins.
    const token = get().scanSeq[domainId] ?? 0

    const result = await window.domainOS.kb.files(domainId)

    // If a scan started since we began, discard — the scan will set files.
    if ((get().scanSeq[domainId] ?? 0) !== token) return

    if (result.ok && Array.isArray(result.value)) {
      set({ files: result.value, filesDomainId: domainId })
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
