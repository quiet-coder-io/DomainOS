import { create } from 'zustand'
import type { Automation, AutomationRun } from '../../preload/api'

interface AutomationState {
  automations: Automation[]
  runs: AutomationRun[]
  loading: boolean

  fetchAutomations(domainId: string): Promise<void>
  createAutomation(input: Parameters<typeof window.domainOS.automation.create>[0]): Promise<Automation | null>
  updateAutomation(id: string, input: Parameters<typeof window.domainOS.automation.update>[1]): Promise<void>
  deleteAutomation(id: string): Promise<void>
  toggleAutomation(id: string): Promise<void>
  runAutomation(id: string): Promise<void>
  fetchRuns(automationId: string, limit?: number): Promise<void>
  resetFailures(id: string): Promise<void>
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  automations: [],
  runs: [],
  loading: false,

  async fetchAutomations(domainId) {
    set({ loading: true })
    const result = await window.domainOS.automation.list(domainId)
    if (result.ok && result.value) {
      set({ automations: result.value, loading: false })
    } else {
      set({ loading: false })
    }
  },

  async createAutomation(input) {
    const result = await window.domainOS.automation.create(input)
    if (result.ok && result.value) {
      set({ automations: [...get().automations, result.value] })
      return result.value
    }
    return null
  },

  async updateAutomation(id, input) {
    const result = await window.domainOS.automation.update(id, input)
    if (result.ok && result.value) {
      set({ automations: get().automations.map((a) => (a.id === id ? result.value! : a)) })
    }
  },

  async deleteAutomation(id) {
    const result = await window.domainOS.automation.delete(id)
    if (result.ok) {
      set({ automations: get().automations.filter((a) => a.id !== id) })
    }
  },

  async toggleAutomation(id) {
    const result = await window.domainOS.automation.toggle(id)
    if (result.ok && result.value) {
      set({ automations: get().automations.map((a) => (a.id === id ? result.value! : a)) })
    }
  },

  async runAutomation(id) {
    const requestId = crypto.randomUUID()
    await window.domainOS.automation.run(id, requestId)
    // Refresh automation (updates runCount, lastRunAt) and runs after a short delay
    // to allow the async engine execution to complete
    setTimeout(async () => {
      const automation = get().automations.find((a) => a.id === id)
      if (automation) {
        const result = await window.domainOS.automation.list(automation.domainId)
        if (result.ok && result.value) set({ automations: result.value })
      }
      const runsResult = await window.domainOS.automation.runs(id, 20)
      if (runsResult.ok && runsResult.value) set({ runs: runsResult.value })
    }, 2000)
  },

  async fetchRuns(automationId, limit) {
    const result = await window.domainOS.automation.runs(automationId, limit)
    if (result.ok && result.value) {
      set({ runs: result.value })
    }
  },

  async resetFailures(id) {
    const result = await window.domainOS.automation.resetFailures(id)
    if (result.ok && result.value) {
      set({ automations: get().automations.map((a) => (a.id === id ? result.value! : a)) })
    }
  },
}))
