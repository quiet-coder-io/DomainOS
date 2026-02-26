import { create } from 'zustand'
import type {
  MissionSummary,
  MissionRunData,
  MissionRunDetailData,
  MissionRunSummaryData,
  MissionRunGate,
  MissionProgressEventData,
} from '../../preload/api'

type PendingGate = { runId: string; gateId: string; message: string }

interface MissionState {
  allMissions: MissionSummary[]
  missions: MissionSummary[]
  missionsLoading: boolean

  // Per-domain run state
  activeRunByDomain: Record<string, MissionRunDetailData | null>
  streamingTextByDomain: Record<string, string>
  runErrorByDomain: Record<string, string | null>
  pendingGateByDomain: Record<string, PendingGate | null>
  activeRequestIdByDomain: Record<string, string | null>

  // Global run tracking (only one run at a time)
  running: boolean
  runningDomainId: string | null
  runningRunId: string | null

  runHistory: MissionRunSummaryData[]
  historyLoading: boolean

  fetchAllMissions(): Promise<void>
  fetchMissions(domainId: string): Promise<void>
  enableForDomain(missionId: string, domainId: string): Promise<void>
  disableForDomain(missionId: string, domainId: string): Promise<void>
  startRun(missionId: string, domainId: string, inputs: Record<string, unknown>): Promise<void>
  cancelRun(): void
  decideGate(approved: boolean, domainId: string): Promise<void>
  fetchRunStatus(runId: string, domainId: string): Promise<void>
  fetchHistory(domainId: string): Promise<void>
  switchDomain(domainId: string): Promise<void>
  checkActiveRun(): Promise<void>
  clearRun(domainId: string): void
  reset(): void
}

// Module-level tracking (outside Zustand, mirrors chat pattern)
const loadedDomains = new Set<string>()
const clearedDomains = new Set<string>()
const switchTokenByDomain = new Map<string, number>()

function getSwitchToken(domainId: string): number {
  return switchTokenByDomain.get(domainId) ?? 0
}

function incrementSwitchToken(domainId: string): number {
  const next = getSwitchToken(domainId) + 1
  switchTokenByDomain.set(domainId, next)
  return next
}

export const useMissionStore = create<MissionState>((set, get) => ({
  allMissions: [],
  missions: [],
  missionsLoading: false,

  activeRunByDomain: {},
  streamingTextByDomain: {},
  runErrorByDomain: {},
  pendingGateByDomain: {},
  activeRequestIdByDomain: {},

  running: false,
  runningDomainId: null,
  runningRunId: null,

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

    // Clear domain slot and set running state
    clearedDomains.delete(domainId)
    set((s) => ({
      running: true,
      runningDomainId: domainId,
      runningRunId: null,
      activeRunByDomain: { ...s.activeRunByDomain, [domainId]: null },
      streamingTextByDomain: { ...s.streamingTextByDomain, [domainId]: '' },
      runErrorByDomain: { ...s.runErrorByDomain, [domainId]: null },
      pendingGateByDomain: { ...s.pendingGateByDomain, [domainId]: null },
      activeRequestIdByDomain: { ...s.activeRequestIdByDomain, [domainId]: requestId },
    }))

    // Subscribe to progress BEFORE IPC call to avoid first-chunk race
    window.domainOS.mission.onRunProgress((event: MissionProgressEventData) => {
      const state = get()
      // Filter: mute if domain was cleared or requestId doesn't match
      const currentRequestId = state.activeRequestIdByDomain[domainId]
      if (!currentRequestId || currentRequestId !== requestId) return

      if (event.type === 'llm_chunk' && event.chunk) {
        set((s) => ({
          streamingTextByDomain: {
            ...s.streamingTextByDomain,
            [domainId]: (s.streamingTextByDomain[domainId] ?? '') + event.chunk,
          },
        }))
      } else if (event.type === 'gate_triggered' && event.gate) {
        const gate = event.gate
        set((s) => ({
          pendingGateByDomain: {
            ...s.pendingGateByDomain,
            [domainId]: {
              runId: event.runId,
              gateId: gate.gateId,
              message: gate.message,
            },
          },
        }))
      } else if (event.type === 'run_complete') {
        get().fetchRunStatus(event.runId, domainId)
      } else if (event.type === 'run_failed') {
        set((s) => ({
          runErrorByDomain: {
            ...s.runErrorByDomain,
            [domainId]: event.error ?? 'Run failed',
          },
        }))
      }
    })

    try {
      const result = await window.domainOS.mission.run(missionId, domainId, inputs, requestId)

      if (result.ok && result.value) {
        const runData = result.value
        set({ runningRunId: runData.id })
        await get().fetchRunStatus(runData.id, domainId)
      } else if (result.error === 'CANCELLED') {
        // Cancellation is not an error
      } else {
        set((s) => ({
          runErrorByDomain: {
            ...s.runErrorByDomain,
            [domainId]: result.error ?? 'Run failed',
          },
        }))
      }
    } catch (err) {
      console.error('[missions] Run IPC error:', err)
      set((s) => ({
        runErrorByDomain: {
          ...s.runErrorByDomain,
          [domainId]: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      window.domainOS.mission.offRunProgress()
      set({ running: false, runningDomainId: null, runningRunId: null })
    }
  },

  cancelRun() {
    const { runningRunId, runningDomainId, activeRunByDomain } = get()
    const runId = runningRunId ?? (runningDomainId ? activeRunByDomain[runningDomainId]?.run.id : null)
    if (runId) {
      window.domainOS.mission.runCancel(runId)
    }
  },

  async decideGate(approved: boolean, domainId: string) {
    const { pendingGateByDomain, runningDomainId } = get()
    const pendingGate = pendingGateByDomain[domainId]
    if (!pendingGate) return

    set((s) => ({
      pendingGateByDomain: { ...s.pendingGateByDomain, [domainId]: null },
    }))

    // Re-subscribe to progress for action execution
    window.domainOS.mission.onRunProgress((event: MissionProgressEventData) => {
      if (event.type === 'run_complete') {
        get().fetchRunStatus(event.runId, domainId)
      } else if (event.type === 'run_failed') {
        set((s) => ({
          runErrorByDomain: {
            ...s.runErrorByDomain,
            [domainId]: event.error ?? 'Run failed',
          },
        }))
      }
    })

    try {
      const result = await window.domainOS.mission.gateDecide(
        pendingGate.runId,
        pendingGate.gateId,
        approved,
      )

      if (result.ok && result.value) {
        await get().fetchRunStatus(result.value.id, domainId)
      } else {
        set((s) => ({
          runErrorByDomain: {
            ...s.runErrorByDomain,
            [domainId]: result.error ?? 'Gate decision failed',
          },
        }))
      }
    } catch (err) {
      console.error('[missions] Gate decide IPC error:', err)
      set((s) => ({
        runErrorByDomain: {
          ...s.runErrorByDomain,
          [domainId]: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      window.domainOS.mission.offRunProgress()
    }
  },

  async fetchRunStatus(runId: string, domainId: string) {
    try {
      const result = await window.domainOS.mission.runStatus(runId)
      if (result.ok && result.value) {
        const detail = result.value
        const isTerminal = detail.run.status === 'success' || detail.run.status === 'failed' || detail.run.status === 'cancelled'
        set((s) => ({
          activeRunByDomain: { ...s.activeRunByDomain, [domainId]: detail },
          // Clear streaming text when terminal detail arrives — output cards become canonical display
          ...(isTerminal ? { streamingTextByDomain: { ...s.streamingTextByDomain, [domainId]: '' } } : {}),
        }))
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

  async switchDomain(domainId: string) {
    // Memory cache hit — already loaded, state intact
    if (loadedDomains.has(domainId)) return

    // Respect user's clear — don't reload from DB
    if (clearedDomains.has(domainId)) {
      loadedDomains.add(domainId)
      return
    }

    loadedDomains.add(domainId)
    const token = incrementSwitchToken(domainId)

    const { running } = get()

    try {
      // Check for an active (non-terminal) run first
      const activeResult = await window.domainOS.mission.activeRun()
      if (getSwitchToken(domainId) !== token) return // stale

      if (activeResult.ok && activeResult.value) {
        const detail = activeResult.value
        if (detail.run.domainId === domainId) {
          set((s) => ({
            activeRunByDomain: { ...s.activeRunByDomain, [domainId]: detail },
          }))
          // Restore gate if gated
          if (detail.run.status === 'gated') {
            const pending = detail.gates.find((g) => g.status === 'pending')
            if (pending) {
              set((s) => ({
                pendingGateByDomain: {
                  ...s.pendingGateByDomain,
                  [domainId]: {
                    runId: detail.run.id,
                    gateId: pending.gateId,
                    message: pending.message,
                  },
                },
              }))
            }
          }
          return
        }
      }

      // No active run for this domain — load latest completed run
      const latestResult = await window.domainOS.mission.latestRun(domainId)
      if (getSwitchToken(domainId) !== token) return // stale

      if (latestResult.ok && latestResult.value) {
        set((s) => ({
          activeRunByDomain: { ...s.activeRunByDomain, [domainId]: latestResult.value! },
        }))
      }
    } catch (err) {
      console.error('[missions] switchDomain failed:', err)
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
      const domainId = run.domainId

      loadedDomains.add(domainId)

      set((s) => ({
        activeRunByDomain: { ...s.activeRunByDomain, [domainId]: detail },
      }))

      if (run.status === 'gated') {
        const pending = detail.gates.find((g) => g.status === 'pending')
        if (pending) {
          set((s) => ({
            pendingGateByDomain: {
              ...s.pendingGateByDomain,
              [domainId]: {
                runId: run.id,
                gateId: pending.gateId,
                message: pending.message,
              },
            },
          }))
        }
      }
    } catch (err) {
      console.error('[missions] Check active run failed:', err)
    }
  },

  clearRun(domainId: string) {
    const { runningDomainId } = get()

    // Only tear down the progress listener if this domain owns the in-flight run
    if (runningDomainId === domainId) {
      window.domainOS.mission.offRunProgress()
    }

    clearedDomains.add(domainId)
    loadedDomains.delete(domainId)

    set((s) => ({
      activeRunByDomain: { ...s.activeRunByDomain, [domainId]: null },
      streamingTextByDomain: { ...s.streamingTextByDomain, [domainId]: '' },
      runErrorByDomain: { ...s.runErrorByDomain, [domainId]: null },
      pendingGateByDomain: { ...s.pendingGateByDomain, [domainId]: null },
      activeRequestIdByDomain: { ...s.activeRequestIdByDomain, [domainId]: null },
    }))
  },

  reset() {
    window.domainOS.mission.offRunProgress()
    loadedDomains.clear()
    clearedDomains.clear()
    switchTokenByDomain.clear()
    set({
      activeRunByDomain: {},
      streamingTextByDomain: {},
      runErrorByDomain: {},
      pendingGateByDomain: {},
      activeRequestIdByDomain: {},
      running: false,
      runningDomainId: null,
      runningRunId: null,
    })
  },
}))
