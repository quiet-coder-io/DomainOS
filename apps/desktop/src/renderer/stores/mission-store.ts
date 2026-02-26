import { create } from 'zustand'
import type {
  MissionSummary,
  MissionRunData,
  MissionRunDetailData,
  MissionRunSummaryData,
  MissionRunGate,
  MissionProgressEventData,
} from '../../preload/api'

interface MissionState {
  allMissions: MissionSummary[]
  missions: MissionSummary[]
  missionsLoading: boolean
  activeRun: MissionRunDetailData | null
  activeRunId: string | null
  running: boolean
  streamingText: string
  runError: string | null
  pendingGate: { runId: string; gateId: string; message: string } | null
  runHistory: MissionRunSummaryData[]
  historyLoading: boolean

  fetchAllMissions(): Promise<void>
  fetchMissions(domainId: string): Promise<void>
  enableForDomain(missionId: string, domainId: string): Promise<void>
  disableForDomain(missionId: string, domainId: string): Promise<void>
  startRun(missionId: string, domainId: string, inputs: Record<string, unknown>): Promise<void>
  cancelRun(): void
  decideGate(approved: boolean): Promise<void>
  fetchRunStatus(runId: string): Promise<void>
  fetchHistory(domainId: string): Promise<void>
  checkActiveRun(): Promise<void>
  clearRun(): void
  reset(): void
}

export const useMissionStore = create<MissionState>((set, get) => ({
  allMissions: [],
  missions: [],
  missionsLoading: false,
  activeRun: null,
  activeRunId: null,
  running: false,
  streamingText: '',
  runError: null,
  pendingGate: null,
  runHistory: [],
  historyLoading: false,

  async fetchAllMissions() {
    try {
      const result = await window.domainOS.mission.list()
      if (result.ok && result.value) {
        set({ allMissions: result.value })
      }
    } catch (err) {
      console.error('[missions] Fetch all failed:', err)
    }
  },

  async enableForDomain(missionId: string, domainId: string) {
    try {
      const result = await window.domainOS.mission.enableForDomain(missionId, domainId)
      if (result.ok) {
        // Refresh both lists
        await Promise.all([get().fetchAllMissions(), get().fetchMissions(domainId)])
      }
    } catch (err) {
      console.error('[missions] Enable failed:', err)
    }
  },

  async disableForDomain(missionId: string, domainId: string) {
    try {
      const result = await window.domainOS.mission.disableForDomain(missionId, domainId)
      if (result.ok) {
        await Promise.all([get().fetchAllMissions(), get().fetchMissions(domainId)])
      }
    } catch (err) {
      console.error('[missions] Disable failed:', err)
    }
  },

  async fetchMissions(domainId: string) {
    set({ missionsLoading: true })
    try {
      const result = await window.domainOS.mission.listForDomain(domainId)
      if (result.ok && result.value) {
        set({ missions: result.value, missionsLoading: false })
      } else {
        console.error('[missions] Fetch failed:', result.error)
        set({ missionsLoading: false })
      }
    } catch (err) {
      console.error('[missions] Fetch IPC error:', err)
      set({ missionsLoading: false })
    }
  },

  async startRun(missionId: string, domainId: string, inputs: Record<string, unknown>) {
    const { running } = get()
    if (running) return

    const requestId = crypto.randomUUID()

    set({
      running: true,
      runError: null,
      streamingText: '',
      pendingGate: null,
      activeRunId: null,
      activeRun: null,
    })

    // Subscribe to progress BEFORE IPC call to avoid first-chunk race
    window.domainOS.mission.onRunProgress((event: MissionProgressEventData) => {
      const state = get()
      // Filter by activeRunId or requestId to avoid cross-run bleed
      if (state.activeRunId && event.runId !== state.activeRunId) return

      if (event.type === 'llm_chunk' && event.chunk) {
        set((s) => ({ streamingText: s.streamingText + event.chunk }))
      } else if (event.type === 'gate_triggered' && event.gate) {
        set({
          pendingGate: {
            runId: event.runId,
            gateId: event.gate.gateId,
            message: event.gate.message,
          },
        })
      } else if (event.type === 'run_complete') {
        // Fetch final run detail
        get().fetchRunStatus(event.runId)
      } else if (event.type === 'run_failed') {
        set({ runError: event.error ?? 'Run failed' })
      }
    })

    try {
      const result = await window.domainOS.mission.run(missionId, domainId, inputs, requestId)

      if (result.ok && result.value) {
        const runData = result.value
        set({ activeRunId: runData.id })

        // Fetch full detail
        await get().fetchRunStatus(runData.id)
      } else if (result.error === 'CANCELLED') {
        // Cancellation is not an error
      } else {
        set({ runError: result.error ?? 'Run failed' })
      }
    } catch (err) {
      console.error('[missions] Run IPC error:', err)
      set({ runError: err instanceof Error ? err.message : String(err) })
    } finally {
      window.domainOS.mission.offRunProgress()
      set({ running: false })
    }
  },

  cancelRun() {
    const { activeRunId } = get()
    if (activeRunId) {
      window.domainOS.mission.runCancel(activeRunId)
    }
  },

  async decideGate(approved: boolean) {
    const { pendingGate } = get()
    if (!pendingGate) return

    set({ pendingGate: null })

    // Re-subscribe to progress for action execution
    window.domainOS.mission.onRunProgress((event: MissionProgressEventData) => {
      if (event.type === 'run_complete') {
        get().fetchRunStatus(event.runId)
      } else if (event.type === 'run_failed') {
        set({ runError: event.error ?? 'Run failed' })
      }
    })

    try {
      const result = await window.domainOS.mission.gateDecide(
        pendingGate.runId,
        pendingGate.gateId,
        approved,
      )

      if (result.ok && result.value) {
        await get().fetchRunStatus(result.value.id)
      } else {
        set({ runError: result.error ?? 'Gate decision failed' })
      }
    } catch (err) {
      console.error('[missions] Gate decide IPC error:', err)
      set({ runError: err instanceof Error ? err.message : String(err) })
    } finally {
      window.domainOS.mission.offRunProgress()
    }
  },

  async fetchRunStatus(runId: string) {
    try {
      const result = await window.domainOS.mission.runStatus(runId)
      if (result.ok && result.value) {
        set({ activeRun: result.value, activeRunId: runId })
      }
    } catch (err) {
      console.error('[missions] Run status IPC error:', err)
    }
  },

  async fetchHistory(domainId: string) {
    set({ historyLoading: true })
    try {
      const result = await window.domainOS.mission.runHistory(domainId)
      if (result.ok && result.value) {
        set({ runHistory: result.value, historyLoading: false })
      } else {
        set({ historyLoading: false })
      }
    } catch (err) {
      console.error('[missions] History IPC error:', err)
      set({ historyLoading: false })
    }
  },

  async checkActiveRun() {
    const { running } = get()
    if (running) return // startRun() in progress, don't interfere

    try {
      const result = await window.domainOS.mission.activeRun()
      if (!result.ok || !result.value) return

      const detail = result.value
      const run = detail.run

      set({ activeRun: detail, activeRunId: run.id })

      if (run.status === 'gated') {
        const pending = detail.gates.find((g) => g.status === 'pending')
        if (pending) {
          set({
            pendingGate: {
              runId: run.id,
              gateId: pending.gateId,
              message: pending.message,
            },
          })
        }
      }
    } catch (err) {
      console.error('[missions] Check active run failed:', err)
    }
  },

  clearRun() {
    window.domainOS.mission.offRunProgress()
    set({
      activeRun: null,
      activeRunId: null,
      running: false,
      streamingText: '',
      runError: null,
      pendingGate: null,
    })
  },

  reset() {
    window.domainOS.mission.offRunProgress()
    set({
      activeRun: null,
      activeRunId: null,
      running: false,
      streamingText: '',
      runError: null,
      pendingGate: null,
    })
  },
}))
