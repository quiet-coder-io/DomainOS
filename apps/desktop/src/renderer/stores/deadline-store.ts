import { create } from 'zustand'
import type { Deadline } from '../../preload/api'

interface DeadlineState {
  deadlines: Deadline[]
  overdueAll: Deadline[]
  loading: boolean

  fetchActive(domainId: string): Promise<void>
  fetchOverdue(): Promise<void>
  create(input: {
    domainId: string; text: string; dueDate: string; priority?: number
    source?: 'manual' | 'briefing'; sourceRef?: string
  }): Promise<Deadline | null>
  snooze(id: string, until: string): Promise<boolean>
  complete(id: string): Promise<boolean>
  cancel(id: string): Promise<boolean>
  findBySourceRef(domainId: string, sourceRef: string): Promise<Deadline | null>
}

export const useDeadlineStore = create<DeadlineState>((set, get) => ({
  deadlines: [],
  overdueAll: [],
  loading: false,

  async fetchActive(domainId: string) {
    set({ loading: true })
    try {
      const result = await window.domainOS.deadline.active(domainId)
      if (result.ok) {
        set({ deadlines: result.value ?? [], loading: false })
      } else {
        console.error('[deadlines] fetchActive failed:', result.error)
        set({ loading: false })
      }
    } catch (err) {
      console.error('[deadlines] fetchActive error:', err)
      set({ loading: false })
    }
  },

  async fetchOverdue() {
    try {
      const result = await window.domainOS.deadline.overdue()
      if (result.ok) {
        set({ overdueAll: result.value ?? [] })
      } else {
        console.error('[deadlines] fetchOverdue failed:', result.error)
      }
    } catch (err) {
      console.error('[deadlines] fetchOverdue error:', err)
    }
  },

  async create(input) {
    try {
      const result = await window.domainOS.deadline.create(input)
      if (result.ok && result.value) {
        // Refresh overdue list
        get().fetchOverdue()
        return result.value
      }
      console.error('[deadlines] create failed:', result.error)
      return null
    } catch (err) {
      console.error('[deadlines] create error:', err)
      return null
    }
  },

  async snooze(id: string, until: string) {
    // Optimistic: remove from lists
    const prev = { deadlines: get().deadlines, overdueAll: get().overdueAll }
    set({
      deadlines: prev.deadlines.filter((d) => d.id !== id),
      overdueAll: prev.overdueAll.filter((d) => d.id !== id),
    })

    try {
      const result = await window.domainOS.deadline.snooze(id, until)
      if (result.ok) return true
      // Rollback
      set(prev)
      console.error('[deadlines] snooze failed:', result.error)
      return false
    } catch (err) {
      set(prev)
      console.error('[deadlines] snooze error:', err)
      return false
    }
  },

  async complete(id: string) {
    // Optimistic: remove from lists
    const prev = { deadlines: get().deadlines, overdueAll: get().overdueAll }
    set({
      deadlines: prev.deadlines.filter((d) => d.id !== id),
      overdueAll: prev.overdueAll.filter((d) => d.id !== id),
    })

    try {
      const result = await window.domainOS.deadline.complete(id)
      if (result.ok) return true
      // Rollback
      set(prev)
      console.error('[deadlines] complete failed:', result.error)
      return false
    } catch (err) {
      set(prev)
      console.error('[deadlines] complete error:', err)
      return false
    }
  },

  async cancel(id: string) {
    // Optimistic: remove from lists
    const prev = { deadlines: get().deadlines, overdueAll: get().overdueAll }
    set({
      deadlines: prev.deadlines.filter((d) => d.id !== id),
      overdueAll: prev.overdueAll.filter((d) => d.id !== id),
    })

    try {
      const result = await window.domainOS.deadline.cancel(id)
      if (result.ok) return true
      // Rollback
      set(prev)
      console.error('[deadlines] cancel failed:', result.error)
      return false
    } catch (err) {
      set(prev)
      console.error('[deadlines] cancel error:', err)
      return false
    }
  },

  async findBySourceRef(domainId: string, sourceRef: string) {
    try {
      const result = await window.domainOS.deadline.findBySourceRef(domainId, sourceRef)
      if (result.ok) return result.value ?? null
      return null
    } catch {
      return null
    }
  },
}))
