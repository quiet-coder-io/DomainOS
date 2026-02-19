import { create } from 'zustand'
import type { PortfolioHealth, BriefingAnalysis } from '../../preload/api'

interface BriefingState {
  health: PortfolioHealth | null
  healthLoading: boolean

  analysis: BriefingAnalysis | null
  analysisSnapshotHash: string | null
  analyzing: boolean
  streamingText: string
  analyzeError: string | null

  fetchHealth(): Promise<void>
  analyze(): Promise<void>
  cancelAnalysis(): void
}

export const useBriefingStore = create<BriefingState>((set, get) => ({
  health: null,
  healthLoading: false,

  analysis: null,
  analysisSnapshotHash: null,
  analyzing: false,
  streamingText: '',
  analyzeError: null,

  async fetchHealth() {
    set({ healthLoading: true })
    try {
      const result = await window.domainOS.briefing.portfolioHealth()
      if (result.ok && result.value) {
        const newHealth = result.value
        const state = get()
        // Invalidate analysis if snapshot hash changed
        const analysisStale =
          state.analysisSnapshotHash !== null &&
          state.analysisSnapshotHash !== newHealth.snapshotHash
        set({
          health: newHealth,
          healthLoading: false,
          analysis: analysisStale ? null : state.analysis,
          analysisSnapshotHash: analysisStale ? null : state.analysisSnapshotHash,
        })
      } else {
        console.error('[briefing] Health computation failed:', result.ok === false ? result.error : 'empty result')
        set({ healthLoading: false })
      }
    } catch (err) {
      console.error('[briefing] Health IPC error:', err)
      set({ healthLoading: false })
    }
  },

  async analyze() {
    const { health, analyzing } = get()
    if (!health || analyzing) return

    const requestId = crypto.randomUUID()

    set({ analyzing: true, analyzeError: null, streamingText: '' })

    // Subscribe to chunks BEFORE IPC call to avoid first-chunk race
    window.domainOS.briefing.onAnalysisChunk((payload) => {
      if (payload.requestId === requestId) {
        set((state) => ({ streamingText: state.streamingText + payload.chunk }))
      }
    })

    try {
      const result = await window.domainOS.briefing.analyze(requestId)

      if (result.ok && result.value) {
        set({
          analysis: result.value,
          analysisSnapshotHash: result.value.snapshotHash,
        })
      } else if (result.error === 'CANCELLED') {
        // Cancellation is not an error — keep analyzeError null
      } else {
        set({ analyzeError: result.error ?? 'Analysis failed' })
      }
    } catch (err) {
      console.error('[briefing] Analysis IPC error:', err)
      set({ analyzeError: err instanceof Error ? err.message : String(err) })
    } finally {
      window.domainOS.briefing.offAnalysisChunk()
      set({ analyzing: false })
    }
  },

  cancelAnalysis() {
    window.domainOS.briefing.analyzeCancel()
  },
}))
